# Shoot Direct to Mac — Requirements

Status: requirements only, nothing built yet. Written 2026-11-09.

## Goal
Shoot should work the way Stow and Pick do: the phone talks straight to the `fp_ops` server on the Mac Studio. Today photos go to the private R2 bucket `product-listings`, and I then have to run `make download-product-creation-images` to get them onto the Mac.

This doc covers three things:
1. **Upload**: photos go from the phone straight to the Mac, with no R2 and no download step.
2. **UI**: the Shoot screens follow the same design language and principles as Pick and Stow. **The camera screen is not touched.**
3. **Shoot log**: every shoot is recorded in the server database, so I can review and trace what was shot.

The workflow stays **Shoot → Stow → Pick → Pack**.

Related: `docs/stow-app/requirements.md` ("the Stow doc") and `docs/order-picking-app/requirements.md` ("the Pick doc"). Shoot uses the same phone, Mac server, address, token and connection indicator.

Code lives in two repos:
- App: this repo.
- Server: `/Users/blickt/Documents/src/ebay_seller_port/fp_ops`.

## Decisions
| Question | Decision |
|---|---|
| Phone can't reach the Mac | Photos wait on the phone and upload when the Mac is reachable. There is no R2 fallback at runtime. |
| Untouched originals | No extra copy is kept on the Mac. See [Risks](#risks-to-accept-or-check). |
| Cutover | A Mac or R2 toggle during a trial, then the R2 path is removed. |
| Upload session on the phone | Foreground. I keep the phone unlocked while shooting, so uploads don't need to continue while it's locked. |
| Camera screen | Not touched, in UI or code. |

## What stays the same
- **Folder layout on the Mac.** Post-processing and listing generation need no changes:
  ```
  <PRODUCT_LISTING_IMAGES_FOLDER>/<date>/<SKU>/
    <SKU>_<nn>.jpg
    <SKU>_<nn>.json     capture sidecar
    listing.env         condition and store, latest upload wins
  ```
- **Capture and preparation.** Square crop, 1600 px maximum, JPEG quality 0.9, as in `src/lib/uploadQueue/prepare.ts`.
- **The durable queue.** `src/lib/uploadQueue/runner.ts` keeps its job folders, per-file resume, serial uploads and Upload Queue actions.
- **The public R2 bucket.** Listing generation uploads to a separate public bucket (`bulk_engine/engine.py`, `upload_to_r2`), which eBay and Shopify read. This work leaves it alone. Only Shoot's private bucket path goes away.
- **The Cloudflare Worker.** The remote shutter depends on it. Only its `/check-sku` and `/presign-upload` routes retire, after the trial.

## Workflow
1. Set the listing config, and enter or scan a SKU. The app gets the next photo number from the Mac.
2. Shoot in the camera and tap Done. The job is saved on the phone and `session_shot` is logged.
3. The queue prepares the photos, then checks that the Mac is reachable.
4. Reachable: each file is sent to the Mac and confirmed. Not reachable: the job waits, and uses none of its retries.
5. Once every file is confirmed, the phone deletes its copy. The photos are already in the right folder on the Mac, so I go straight to post-processing.

## Part 1: Upload to the Mac

### Server API
All routes use the existing bearer token. The `before_request` hook in `server.py` covers new routes automatically.

#### 1. `GET /shoot/sku?date=2026-11-09&sku=AAU-1109-012`
Used for start numbers and collision checks. Same response shape as the Worker's `/check-sku`, computed from the files on disk:
```json
{ "count": 8, "nextNumber": 9, "numbers": [1, 2, 3, 4, 5, 6, 7, 8] }
```
- `numbers` comes from `<SKU>_<nn>.jpg` files in the SKU folder. A SKU folder that doesn't exist returns `count: 0`, `nextNumber: 1`.
- If `PRODUCT_LISTING_IMAGES_FOLDER` itself doesn't exist (drive not mounted), return **503**, not `count: 0`, or the phone could reuse numbers already on the drive.

#### 2. `PUT /shoot/files/<date>/<sku>/<filename>`
The body is the raw file. Headers:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <token>` |
| `Content-Type` | `image/jpeg`, `application/json` or `text/plain` |
| `X-Content-MD5` | Hex MD5 of the file, from `file.info({ md5: true })` |
| `X-Shoot-Session` | The job ID |
| `X-Shoot-Device` | The device name. Non-ASCII characters are sent as `?`. |

Validation:
- `date` is `YYYY-MM-DD`.
- `sku` matches the Worker's `^[A-Za-z0-9_-]+$`. It must not use the stricter uppercase `SKU_RE` from `fp_ops/images.py`, or valid existing SKUs could be refused.
- `filename` is `<sku>_<nn>.jpg`, `<sku>_<nn>.json` or `listing.env`.

Writing the file, in this order:
1. If `PRODUCT_LISTING_IMAGES_FOLDER` doesn't exist, return 503. `/Volumes/J15` is an external drive. The server must **never create the root folder**, or photos would land on an empty mount point.
2. Stream the body to `<root>/.incoming/`, which is on the same volume and isn't inside any date folder.
3. Check the length and MD5.
4. Under a lock, apply the outcomes below.
5. Create the date and SKU folders if needed, fsync the file, then `os.replace` it into place.
6. Record the receipt in `shoot_files`, then respond.

**A 2xx means the file is safely on the drive.** The phone deletes its copy after that, and the Mac then holds the only copy.

Outcomes:

| Case | Response | What the phone does |
|---|---|---|
| New file stored | 200 | Marks it uploaded |
| Same MD5 as the receipt, or as an existing file with no receipt | 200 `{ "duplicate": true }` | Marks it uploaded |
| Different content already at that name | 409 | Needs attention |
| `listing.env` | 200, always replaced | Marks it uploaded |
| Invalid date, SKU or filename | 400 | Rejected, no automatic retry |
| Over the 25 MiB cap | 413 | Rejected, no automatic retry |
| MD5 or length mismatch | 422 | Normal retry |
| Drive not mounted | 503 `{ "error": "storage_offline" }` | Parks, uses no retry |
| Bad token | 401 | Needs attention, "Check the Mac token" |

**Why receipts are needed.** Post-processing overwrites photos in place. If a response is lost and the phone resends a file after post-processing has run, the file on disk no longer matches. The receipt shows that this exact file was already received, so the processed photo isn't overwritten and no false conflict is raised.

### Server changes
- Add `PRODUCT_LISTING_IMAGES_FOLDER` to `Settings` in `fp_ops/config.py`. The value is already in the root `.env`, which `fp_ops` loads.
- Add the routes to `fp_ops/server.py`, with the logic in a new `fp_ops/shoot.py`, and update the endpoint list at the top of `server.py`.
- Set a 25 MiB body cap.
- Add pytest coverage in `fp_ops/tests`, modelled on `test_auth_required` and `test_events_idempotent_and_status` in `test_server.py`, and on `test_stow.py`. Cover every row of the outcomes table, path traversal attempts, and a missing images folder.

### App changes
- **Destination layer.** A new module in `src/lib/uploadQueue/` with Mac and R2 implementations of "look up numbers" and "upload files". `runner.ts` (the collision check, upload loop and `renumber`) and the start-number lookup in `src/app/(tabs)/index.tsx` call it instead of `uploadApi.ts` directly.
- **Same connection as Pick.** Use `serverUrl` from the Pick store. Export an auth-header helper from `src/lib/pick/api.ts`, because `TOKEN` is private there. Use the existing `call()` for JSON requests only. It can't send files.
- **Upload call.** `file.upload(url, { httpMethod: 'PUT', headers, sessionType: 'foreground' })`. A non-2xx resolves rather than rejects, so the status must be checked, as `runner.ts` does today.
- **Non-blocking.** Done still returns to Shoot home straight away, and uploads keep running while the next item is shot. A file interrupted because the app left the foreground is resent by the existing retries.
- **Reachability.** The queue's `online` flag only means "has a network", which is also true on cellular or away from home. In Mac mode, call `checkHealth` before each job. If it fails, park with `nextAttemptAt: null` and use no attempt. Re-arm on a 30 s timer, on app foreground, and on network change.
- **Startup order.** `startUploadQueue()` runs before `startPickStore()` in `src/app/_layout.tsx`, and the server URL override loads in the Pick store. The queue must not start a job until the URL has loaded.
- **New job state `rejected`.** For a 400 or 413, or a 409 after part of the job has already uploaded. `retryAll` must skip it. It appears under Needs attention with Save to Photos and Delete.
- **Conflict.** A 409 before anything in the job has uploaded uses the existing `conflict` state and Renumber.
- **SKU validation.** Block Start Capture on a SKU the server would reject. Today a bad SKU only fails at upload.
- **Native config.** Nothing required for the trial, because `NSAllowsLocalNetworking` and the local network permission are already in `app.json`. Updating the `NSLocalNetworkUsageDescription` text to mention photos is optional and needs a native rebuild.

### Trial and cutover
1. **Before switching,** run `make download-product-creation-images` one last time so nothing is left behind on R2.
2. **Setting:** a Mac or R2 choice on the Mac Server screen (`src/app/pick-settings.tsx`), saved in `Documents/pick/settings.json`. **The app defaults to R2 until the server is live**, so a phone keeps working before then. Switch to Mac on that screen once the routes are deployed, and change `DEFAULT_UPLOAD_DESTINATION` in `src/lib/pick/store.ts` to `'mac'` when the trial starts.
3. **Job pinning:** a job follows the setting until its first file is confirmed, then stays on that destination, so one job is never split across two places. A job waiting for the Mac can still be moved to R2 by switching the setting. Jobs that were part-way through when the update installs stay on R2.
4. **During the trial** the Mac pipeline is unchanged. **Don't switch modes in the middle of a SKU:** the downloader skips any SKU folder that already exists, so R2 photos for a SKU that also went to the Mac on the same date would be silently left behind.
5. **After the trial, remove:**
   - the toggle and the R2 code from the app (`src/lib/uploadApi.ts`, the R2 side of the destination layer);
   - `/check-sku`, `/presign-upload` and the R2 secrets from the Worker, keeping the remote shutter routes;
   - the download step from `make product-creation-images` and from the `photos-generate` workflow in `ops_console/tasks.py`.

   Keep `scripts/download_product_listing_images.py` until I've confirmed R2 holds nothing I still need.

## Part 2: Shoot UI

**In scope:** Shoot home, Listing Config, Upload Queue.

**Not touched:** `src/app/camera.tsx`, the `outline` variant of `UploadQueueBadge` that the camera displays, and the `/scan` barcode camera screen.

Shoot already uses `Card`, `Button` and `theme`. What's left is the structure and behaviour of Pick and Stow.

### Principles carried over from Pick and Stow
- Everything is recorded on disk before it's sent.
- Connection state is always visible.
- One primary action per screen.
- Every failure says what to do next.
- Colours, type and components come from `src/lib/theme.ts` and `src/components/ui.tsx`, with no one-off hex values.

### Shoot home
```
┌────────────────────────────────────┐
│ Shoot                   ● Mac  ⟳   │  native large title
├────────────────────────────────────┤
│ ↑ 12 photos waiting                │  sync line, tap for Upload Queue
├────────────────────────────────────┤
│ ✓ AAU-1109-012 scanned             │  banner, when there is one
├────────────────────────────────────┤
│ Mac folder        2026-11-09/      │
├────────────────────────────────────┤
│ SKU                                │
│ [ AAU-1109-012            ]  [▣]   │
│ Existing files: 8 · 4 queued       │
│ [        📷 Start Capture       ]  │
├────────────────────────────────────┤
│ Listing                            │
│ NEW   foundandprofound          ›  │
├────────────────────────────────────┤
│ Recent sessions                    │
│  Today 14:10  AAU-1109-012         │
│               8 photos · On Mac    │
│  Today 14:02  AAU-1109-011         │
│               6 photos · 2 missing │
├────────────────────────────────────┤
│    📷 Shoot    📥 Stow    📦 Pick    │
└────────────────────────────────────┘
```

| # | Area | Today | Requirement |
|---|---|---|---|
| U1 | Navigation | Hand-drawn `Text` title in a `SafeAreaView` | A nested `Stack` with `headerLargeTitleEnabled` and `headerShadowVisible: false`, as in `stow/_layout.tsx`. The app's `/` must still open Shoot, and returning from `/camera` must still work. |
| U2 | Mac status | None | The same `desktopcomputer` icon with a green or red dot opening `/pick-settings`, plus refresh. Extract `HeaderButtons` from `stow/index.tsx` into one shared component. |
| U3 | Page body | Static view | A `ScrollView` with `contentInsetAdjustmentBehavior="automatic"` and a `RefreshControl`. Pull to refresh reloads Recent sessions and the SKU check. |
| U4 | Send status | A chip inside the session card with hard-coded colours | One sync line, in Stow's format. Tap opens Upload Queue. |
| U5 | Scanner | Typed field and camera `/scan` only | `ScanCapture` and `ScanBanner`, with sound and haptics from `feedback.ts`. A Bluetooth scan fills the SKU with a green banner. A barcode that isn't a valid SKU gives the red banner and leaves the field unchanged. `ScanCapture` is `enabled={false}` while the SKU field has focus. `/scan` stays. |
| U6 | Result messages | `Toast` | "Queued 8 photos for AAU-1109-012" uses the banner style, without a sound. |
| U7 | History | None | "Recent sessions" from `GET /shoot-state`, cached on the phone. Pick and Stow's row style. No new detail screen. |
| U8 | Tab bar | No badge | The Shoot tab shows the number of jobs needing attention, hidden at zero, as Pick's badge does. |
| U9 | Wording | "R2", "Session folder" | Say "Mac", as Pick and Stow do. Includes the strings in `upload-queue.tsx`, the Home notes, and code comments. During the trial, a job pinned to R2 may say R2. |

**Sync line states**, highest priority first:

| State | Text | Colour |
|---|---|---|
| Jobs need attention | `! 2 need attention` | red |
| Drive not mounted | `Mac drive offline · 12 photos waiting` | orange |
| Mac not reachable | `Waiting for Mac · 12 photos waiting` | orange |
| Sending | `↑ 12 photos waiting` | orange, as Stow's unsent line |
| Nothing waiting | `All on Mac` | secondary label |

**Banners**
```
 SKU scanned:
┌────────────────────────────────────┐
│ ✓ AAU-1109-012 scanned             │  green, ding + haptic
└────────────────────────────────────┘
 Session queued:
┌────────────────────────────────────┐
│ ✓ Queued 8 photos for AAU-1109-012 │  green, no sound
└────────────────────────────────────┘
 Not a valid SKU:
┌────────────────────────────────────┐
│ ✕ Unrecognised barcode: X12!       │  red, buzz
└────────────────────────────────────┘
```

### Upload Queue
- Keep the sections (Needs attention, In progress, Completed today) and the actions.
- Add the `rejected` state to `STATUS_LABELS` and `STATUS_LOOK`.
- Show "Waiting for Mac" and "Mac drive offline" as job details in place of "waiting for network".
- Replace the R2 wording, including the Delete warning, which becomes "have not reached the Mac and will be lost".

### Listing Config
No layout change. Check colours and copy only.

## Part 3: Shoot log

**Purpose:** months later, I can tell what was shot, when, on which device, with what listing settings, and whether every photo reached the Mac.

**Limit that comes from not touching the camera.** The log starts when I tap Done, through `enqueue()` in `runner.ts`. Sessions discarded in the camera and single shots deleted there are not recorded. Recording them later would need a change to `camera.tsx`.

### What is logged
| `action` | When | Fields beyond the common ones |
|---|---|---|
| `session_shot` | Done tapped | `numbers`, `shot_started_at`, `shot_ended_at`, `item_condition`, `ebay_store`, `destination`, `numbered_offline` |
| `upload_complete` | All files confirmed by the destination | `photo_count` |
| `upload_conflict` | Number clash | `numbers` (the clashing ones) |
| `upload_rejected` | Permanent rejection | `http_status`, `error` |
| `upload_failed` | The first time a job runs out of retries | `error` |
| `renumbered` | Renumber action | `from_numbers`, `to_numbers` |
| `exported_to_photos` | Save to Photos | `photo_count` |
| `deleted_from_phone` | Delete on an unfinished job | `numbers` that never reached the Mac |

`deleted_from_phone` is the permanent record of photos I chose to lose.

`shot_started_at` and `shot_ended_at` are the first and last photo's `capturedAt`.

Not logged: each retry attempt (too noisy to be useful, and the final outcome is recorded) and location (the sidecar has none).

### App requirements
- **L1 Outbox.** A new `src/lib/shootLog/`, modelled on `src/lib/stow/store.ts`. Events are written to `Documents/shoot/events.json` before sending. `Documents/shoot/meta.json` holds `install_id` and `nextSeq`. 500 ms debounce, retry every 30 s and on foreground, batches of up to 200.
- **L2 Source.** Events are emitted from `runner.ts` only: `enqueue`, `renumber`, `exportToPhotos`, `remove`, and status changes. `session_id` is the job ID. `remove` logs `deleted_from_phone` only when the job isn't `done`.
- **L3 Independence.** Logging must never block shooting or uploading. The outbox is separate from job folders, so it survives job cleanup.
- **L4 Both modes.** Logged in Mac and R2 mode, with `destination` recorded.
- **L5 Startup.** Started in `src/app/_layout.tsx` after the Pick store, which loads the server URL.
- **L6 Sequence.** `seq` goes up by exactly 1 for every event on this install, across restarts, as in Stow. It's how the audit proves nothing was lost.

### Server API

#### 1. `POST /shoot-events`
```json
{
  "device": "iPhone 15 Pro Max",
  "install_id": "uuid",
  "app_version": "1.0.0",
  "events": [{
    "event_id": "uuid",
    "session_id": "job id",
    "seq": 412,
    "action": "session_shot",
    "date_root": "2026-11-09",
    "sku": "AAU-1109-012",
    "numbers": [1, 2, 3, 4, 5, 6, 7, 8],
    "shot_started_at": "2026-11-09T22:08:11Z",
    "shot_ended_at": "2026-11-09T22:09:40Z",
    "item_condition": "pre-owned",
    "ebay_store": "foundandprofound",
    "destination": "mac",
    "numbered_offline": false,
    "at": "2026-11-09T22:09:41Z"
  }]
}
```
→ `{ "accepted": ["event_id", …] }`

- An `event_id` already seen is accepted again and ignored.
- An event is listed as accepted only after it and its derived changes commit in **one transaction**, under the existing `write_lock` in `fp_ops/events.py`.
- A malformed event is stored with `action: malformed` and its raw content, then accepted. Stow leaves such an event queued on the phone forever, and Shoot should not.

#### 2. `GET /shoot-state?days=7`
Recent sessions for the Shoot home list. Newest first.
```json
{
  "generated_at": "2026-11-09T22:30:00Z",
  "sessions": [{
    "session_id": "job id",
    "sku": "AAU-1109-012",
    "date_root": "2026-11-09",
    "shot_ended_at": "2026-11-09T22:09:40Z",
    "photos_declared": 8,
    "photos_received": 8,
    "status": "complete",
    "destination": "mac"
  }]
}
```

#### 3. `GET /shoot-audit`
Read-only JSON, modelled on `fp_ops/stow_audit.py`. Takes one of:
- `?sku=AAU-1109-012`
- `?date=2026-11-09`
- `?session=<session_id>`
- `?batch=AAU-1109`
- `?check=integrity`
- `?check=unstowed`

### Data the server keeps
Rules, the same as Stow:
- In the existing SQLite database, in tables separate from Pick and Stow.
- Created by a new `ensure_shoot_schema`, called in `create_app` next to `ensure_location_schema`.
- Kept forever.

**1. `shoot_events`: what happened.** Append-only, with UPDATE and DELETE blocked by triggers, as in `fp_ops/locations_db.py`. Every event field, plus `device`, `install_id`, `app_version`, and `received_at` in server time.

The server also adds its own rows, with `install_id` and `seq` null, so that a refused upload is on record even if the phone's event never arrives:
- `server_conflict`: a 409 on upload.
- `server_rejected`: a 400 or 413 on upload.

**2. `shoot_sessions`: derived, one row per `session_id`.** Always rebuildable from the events and file receipts.
- `install_id`, `device`, `date_root`, `sku`
- `shot_started_at`, `shot_ended_at`
- `photos_declared`, `photos_received`
- `item_condition`, `ebay_store`, `destination`
- `last_error`, `completed_at`
- `status`:

| Status | Meaning |
|---|---|
| `shot` | Declared, nothing received yet |
| `uploading` | Some files received |
| `complete` | See the rule below |
| `conflict` | Waiting for Renumber |
| `rejected` | Refused permanently |
| `failed` | Ran out of retries, and may still recover |
| `abandoned` | Deleted from the phone before finishing |

**Complete rule.** In Mac mode, a session is `complete` when the server holds every declared JPEG and sidecar, whatever the phone reports. In R2 mode, it relies on the phone's `upload_complete`, because the server sees no files.

**Renumbering.** The latest `renumbered` event sets the declared numbers.

**3. `shoot_files`: one row per file received.** Keyed by `date_root`, `sku`, `filename`, and also used for upload retries.
- `kind`: `photo | sidecar | listing_env`
- `session_id`, `md5`, `size_bytes`, `device`
- `first_received_at`, `last_received_at`

Files may arrive before their `session_shot` event. The session is filled in when that event arrives.

**4. `shoot_photos`: one row per photo.** Keyed by `date_root`, `sku`, `number`, and filled when the sidecar arrives.
- `session_id`, `filename`, `captured_at`
- `lens`, `zoom`, `iso`, `exposure_time`, `exposure_bias`, `focal_length`
- original and output dimensions, `app_version`
- `sidecar_json`: the full sidecar as received

A sidecar that can't be parsed is still stored as a file and never fails its upload. Photo rows stay empty for R2-mode jobs, because their sidecars don't reach the server.

### Questions this must answer (acceptance)
- **Given a SKU**: every session, when it was shot, photo count, condition and store, device, where the files are, status, and whether it was reshot.
- **Given a date**: the SKUs shot, photos per SKU, first and last shot times, and totals.
- **Given a session**: declared versus received photos, and every event in order.
- **Given a batch (`PREFIX-MMDD`)**: the SKUs shot, and **gaps in the `NNN` sequence**, using the same `parse_sku` approach as Stow's batch check.
- **Shot but not stowed** (`?check=unstowed`), and stowed but never shot, joined against `stow_events`. SKUs compare case-insensitively.
- **Knowingly lost photos**: every `deleted_from_phone` event.
- **Integrity check** (`?check=integrity`), which should return nothing:
  - gaps in `seq` for any `install_id`;
  - sessions not `complete` after 24 hours with no recorded reason;
  - receipts whose file is gone from disk;
  - photos on disk with no receipt, from the date the log went live.

## Build order
1. Server upload routes, receipts and tests.
2. App destination layer, reachability gate and toggle. Start the trial.
3. Shoot log, server then app.
4. Shoot UI.
5. After the trial, remove the R2 path.

## Risks to accept or check
- **Uploads stop when the app leaves the foreground.** If the phone locks or I switch apps, the file in flight fails and the queue continues when the app is active again, through the existing retries.
- **No recovery copy.** `postprocess_product_images.py` overwrites originals in place and relies on re-downloading from R2 to recover. Mac-mode photos have no such copy, so a bad post-process run can't be undone, and J15 holds the only copy of each shot unless it's backed up separately.
- **The Mac must be on, with J15 mounted, for photos to leave the phone.** Waiting photos take up phone storage. The existing low-storage warning stays.
- **Shoot route change (U1).** Moving the Shoot tab under a nested Stack changes its route. Test the remote shutter, the volume shutter and the return from the camera.
- **Hidden scan input on Home (U5).** `ScanCapture` holds focus and re-takes it every 800 ms, so it must be off while the SKU field is being edited, or typing would be interrupted.
- **Expo version.** The app is on Expo 57 (`expo-file-system ~57.0.7`), while `AGENTS.md` still links to the v54 docs. Build against the installed version.

## Acceptance
**Upload**
- Shoot on home Wi-Fi, and the files are in the right folder with no download step.
- With the Mac off, photos wait, then upload later with no retries used.
- Cutting the connection mid-job leaves no duplicate or partial files.
- Unmounting J15 gives a 503 and a parked queue, and nothing is written to the empty mount point.
- Resending a file after post-processing does not overwrite it.
- Renumber still works.
- Post-processing and `generic_bulk` run unchanged on an uploaded SKU.
- The remote shutter still works.

**UI**
- Shoot home, Listing Config and Upload Queue meet U1 to U9 and the Upload Queue requirements.
- `src/app/camera.tsx` has no diff.

**Log**
- Every question above returns correct results for a real test session, including one renumbered job and one deleted job.
- Events recorded while offline arrive exactly once, with no `seq` gaps.

## Out of scope
- Access from outside the home network, such as Tailscale, as with Pick and Stow.
- Running post-processing automatically when photos arrive.
- The stale `dateRoot` when the app is left open past midnight.
- A report comparing what was shot with what was listed. The log supports adding one.
- Importing shoots from before the log goes live. A one-off backfill from existing J15 folders and sidecars is a possible follow-up.
- Fixing `AGENTS.md` and `README.md`.

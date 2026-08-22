# Plan: Phase 3 — R2 Upload via Cloudflare Worker

## Context
Phase 2 crops/resizes/renames photos locally and shows a placeholder "would upload to R2" alert. Phase 3 makes that upload real. The R2 bucket (`product-listings`) is private with no public access, so R2 credentials can never live in the app — something else has to hold them and mediate the upload. Decided in discussion with the user:

- **A new Cloudflare Worker** (no existing backend to reuse) issues short-lived **presigned PUT URLs** — R2 secrets stay server-side (as Wrangler secrets, never in git), and photo bytes flow **directly from the device to R2**, not through the Worker (avoids payload-size limits and double bandwidth).
- The Worker is protected by a **shared app-level token** (distinct from the R2 secret) — low-stakes if it ever leaked from the app bundle, since it only grants "can ask for an upload URL for this bucket," not direct R2 access.
- Upload happens **synchronously**, extending the existing Done-time spinner already built in Phase 2 (no background task/retry-queue infrastructure).
- **SKU collision handling**: the app checks R2 for existing files under `{dateRoot}/{sku}/` when a SKU is entered, shows "Existing files: N" as an informational hint under the SKU field, and — the key behavior — **new photos continue numbering from the last existing file** (`max existing NN + 1`), computed from the actual existing filenames (not just a count, so it stays correct even if a file was manually deleted from R2 outside the app). The Camera View never displays old photos, only the newly captured ones.

## Architecture

### Cloudflare Worker (`/worker`)
Independent project (own `package.json`/`node_modules`) using **`aws4fetch`** (lightweight SigV4 signing built for edge/Workers runtimes — chosen over the Node-oriented `@aws-sdk/client-s3`, which doesn't run well in Workers or React Native) to sign requests against R2's S3-compatible endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/product-listings`).

- `wrangler.toml` — `R2_ACCOUNT_ID` and `R2_BUCKET_NAME` as plain vars (not sensitive — the account ID is visible in any presigned URL's hostname anyway). `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `APP_SHARED_TOKEN` are Wrangler **secrets** (`wrangler secret put ...` when deployed; `.dev.vars`, gitignored, for local `wrangler dev`).
- `src/index.ts` — two endpoints, both requiring `Authorization: Bearer <APP_SHARED_TOKEN>` (401 otherwise):
  - `GET /check-sku?date=&sku=` — lists R2 objects via `ListObjectsV2` with prefix `{date}/{sku}/`, parses the XML response's `<Key>` elements with a regex (no XML parser dependency needed for this narrow case), matches filenames against `${sku}_(\d+)\.jpg`, returns `{ count, nextNumber }` (`nextNumber` = max matched NN + 1, or 1).
  - `POST /presign-upload` — body `{ date, sku, filenames[] }` (one round trip for the whole session), returns `{ uploadUrls: { [filename]: string } }`. Each URL is signed with `signQuery: true` and an explicit `X-Amz-Expires=300` query param set *before* signing (aws4fetch only defaults `X-Amz-Expires` to 86400 if it isn't already present on the URL).
  - Both endpoints validate `date`/`sku`/`filenames` against a strict `[A-Za-z0-9_-]+` pattern before building any R2 key, to avoid path-traversal-style key injection.

### App config
- `EXPO_PUBLIC_WORKER_URL`, `EXPO_PUBLIC_APP_TOKEN` in `.env` (gitignored; `.env.example` committed as a template). Expo natively inlines `EXPO_PUBLIC_*` vars at build time — no extra package needed.
- `src/lib/uploadApi.ts` — shared client for both screens: `checkSku(date, sku)` and `presignUpload(date, sku, filenames)`, both attaching the `Authorization` header and throwing on non-OK responses.

### Home View (`src/app/index.tsx`)
- Debounced (~500ms, via a `useEffect` + `setTimeout`/cleanup) call to `/check-sku` on SKU/date change; result tagged with the SKU it was computed for (`{ sku, count, nextNumber }`) so a stale in-flight response can never be shown against different SKU text.
- "Existing files: N" shown under the input when the tagged result matches the current SKU and `count > 0`.
- "Start Capture": if no matching check result exists yet for the current SKU (still in flight or never fired), performs one on-demand check before navigating (button shows a spinner). If that check fails, shows an alert and **blocks navigation** — proceeding with a guessed `nextNumber` risks silently overwriting real files, so this is a hard stop rather than a soft warning.
- Passes `sku`, `dateRoot`, and `startNumber` (stringified) as route params to `/camera`.

### Camera View (`src/app/camera.tsx`)
- Reads `startNumber` from route params (`Number(startNumber) || 1` as a defensive fallback).
- `handleDone` now runs two passes inside the existing processing-spinner block, updating `processingLabel` live at each step (e.g. "Preparing photo 3 of 8...", then "Uploading photo 3 of 8..."):
  1. **Local prep** (unchanged from Phase 2, but numbering is now `startingNumber + index` instead of `index + 1`): crop → conditional resize to 1600 → Camera Roll save → copy into the session's local folder. Before copying, deletes any pre-existing file at that destination path first (defensive — makes a Done-retry-after-failure safe to re-run, since it reuses the same filenames).
  2. **Upload**: one `presignUpload` call for all filenames in the batch, then for each file: `fetch(localUri).then(r => r.blob())` → `fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } })`.
- On success: navigates back to Home View, which shows a non-blocking success toast with the real count/path (see "Update (toasts + SKU auto-increment)" below — this replaced the original blocking alert).
- On any upload failure: stops the loop, shows a non-blocking error toast on the Camera View itself, and **stays on the Camera View** with the session's photos intact — the user just taps Done again to retry the whole batch. Full-batch retry (not per-photo resume) is a deliberate scope choice for this phase.

## Files touched
- `worker/` — new: `package.json`, `wrangler.toml`, `tsconfig.json`, `src/index.ts`, `.dev.vars.example`.
- `.env.example` — new (committed template); `.env` — new (gitignored, filled in by the user with real values, never by Claude).
- `.gitignore` — added `.env`, `worker/.dev.vars`, `worker/.wrangler/`.
- `src/lib/uploadApi.ts` — new shared Worker client.
- `src/lib/sessionResult.ts` — new (added in the toast follow-up) pending-result handoff between Camera View and Home View.
- `src/components/Toast.tsx` — new (added in the toast follow-up) shared toast banner.
- `src/app/index.tsx` — existing-files check + display, blocking Start Capture on an unresolved/failed check, passes `startNumber`; also SKU auto-increment + toast (toast follow-up).
- `src/app/camera.tsx` — numbering from `startNumber`, real presigned-URL upload step, live processing label; toast + thumbnail auto-scroll (toast follow-up).

## What's left for the user to do (secrets can't be handled by Claude)
1. `cd worker && npx wrangler login` — one-time browser login to the Cloudflare account that owns the `product-listings` bucket.
2. Fill in `worker/wrangler.toml`'s `R2_ACCOUNT_ID` placeholder with the real Cloudflare account ID.
3. Set the deployed secrets (each prompts for a hidden value):
   ```
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret put APP_SHARED_TOKEN   # any random string you choose — this is the shared app token, not an R2 credential
   ```
4. (Optional, for local `wrangler dev` testing) Copy `worker/.dev.vars.example` to `worker/.dev.vars` and fill in the same three values locally.
5. `cd worker && npx wrangler deploy` — deploys the Worker, prints its `*.workers.dev` URL.
6. Copy `.env.example` to `.env` at the repo root, set `EXPO_PUBLIC_WORKER_URL` to that deployed URL and `EXPO_PUBLIC_APP_TOKEN` to the same value used for `APP_SHARED_TOKEN` above.
7. Restart `npx expo start` (env vars are read at bundle time) and test.

## Update (toasts + SKU auto-increment, thumbnail auto-scroll)
Three follow-up refinements after initial end-to-end testing:

- **Non-blocking toasts replace both `Alert.alert` calls in `handleDone`.** New `src/components/Toast.tsx` (a simple absolutely-positioned banner, green for success / red for error, self-contained `useSafeAreaInsets` so it clears the status bar/notch on both screens — moved to the *top* of the screen after testing showed a bottom-anchored toast got hidden behind the iOS keyboard) and `src/lib/sessionResult.ts` (a tiny synchronous "pending result" module-level channel, since expo-router's `router.back()` can't carry new params to the screen being returned to the way `router.push()` can). Camera View sets the pending result and calls `router.back()` on success (no alert); on failure it shows the toast locally and stays put, unchanged from before. Home View's existing focus effect (see below) reads and displays the pending result.
- **SKU no longer clears after a successful upload — it auto-increments.** SKUs follow a `PREFIX-DATE-NNN` convention (e.g. `BUD-0820-005`); a new `incrementTrailingNumber()` helper in `src/app/index.tsx` matches a trailing `-NNN`, increments it, and re-pads to the same digit width, leaving the field untouched if the SKU doesn't end in that pattern. Runs in the same `useFocusEffect` that already fires only on successful return from Camera View (failure never navigates back, so this — and the increment — structurally never fires after a failed upload, with no extra gating needed). A `skuRef` mirrors the live input value so the effect can read it without depending on `sku` directly, which would otherwise change the callback's identity on every increment and re-trigger `useFocusEffect` in a runaway loop (it re-invokes immediately when the callback identity changes while the screen is already focused). A brief (~900ms) border/background flash on the input signals the auto-increment happened.
- **Thumbnail strip auto-scrolls to the newest photo.** The strip was already a working horizontal `ScrollView`, but with 8+ photos a newly captured one could append off-screen with no visual cue beyond a barely-visible sliver at the edge. A `useEffect` watching `photos.length` now calls `scrollToEnd({ animated: true })` whenever it increases (not on deletions, so removing an earlier thumbnail doesn't yank the view back to the end), and the scroll indicator was turned back on as a persistent affordance.

## Verification
- Worker: `npx tsc --noEmit` clean (already verified); `wrangler dev` locally, then `wrangler deploy`.
- App: `npx tsc --noEmit` / `npx expo-doctor` clean (already verified).
- On-device: fresh SKU shows no "Existing files" text and starts at `_01`; re-running the same SKU shows "Existing files: N" and the new session starts at `N+1`; capture a few photos, tap Done, confirm the live "Preparing/Uploading photo X of Y" spinner text, confirm the success alert, then check the Cloudflare R2 dashboard to confirm files landed at `/{dateRoot}/{sku}/{sku}_NN.jpg`. Also test a failure path (e.g. airplane mode mid-upload) to confirm the error alert appears and the session isn't lost.

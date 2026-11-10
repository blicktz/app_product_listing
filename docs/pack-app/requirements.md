# Pack App — Requirements

Status: requirements written 2026-11-10. Part A (app) is built in this repo. Part B (server) is built separately in `fp_ops`.

## Goal
Pack is the last step. Each package is checked by scanning its shipping label and every item that goes in it, so the wrong item is never shipped and nothing is left out. Every scan is recorded so that a complaint can be answered from the record months later.

Today this runs in the desktop Ops Console's Packing tab (`ebay_seller_port/ops_console/packing.py`, `packing_tab.py`, `packing_sync.py`; design notes in `ops_console/docs/ops-console.md`, "Packing tab"). This doc moves it onto the phone as the **fourth tab**, using the same phone, scanner, Mac server and design as Shoot, Stow and Pick.

The workflow is **Shoot → Stow → Pick → Pack**.

Related: `docs/order-picking-app/requirements.md` ("the Pick doc") and `docs/stow-app/requirements.md` ("the Stow doc").
**Running alongside the desktop:** `docs/pack-app/parallel-run.md` lists what the app must change because the phone and the desktop can pack at the same time (conflicts, auto-refresh, new fields). The app side's decisions are in `docs/pack-app/parallel-run-app-response.md`; this doc already includes them.

Code lives in two repos:
- App (Part A): this repo.
- Server (Part B): `/Users/blickt/Documents/src/ebay_seller_port/fp_ops`.

## Decisions
| Question | Decision |
|---|---|
| Desktop Packing tab | **Kept, and it keeps working.** The phone and the desktop work on the same `packing_*` rows. The server writes them exactly as the desktop does, so either one can be used on any day and each sees the other's scans. |
| Where scan rules run | **On the phone**, without waiting on the network, as Pick and Stow do. Every scan is written to an on-disk queue and sent in the background. The server stores the events and keeps `packed_at` up to date. |
| Device | iPhone with the Eyoyo Bluetooth scanner in HID mode, as for Pick and Stow. Phone layout only. |
| Database | The existing `packing_orders`, `packing_items`, `packing_scans` and `packing_loads` tables in the main DB. **No new tables.** `packing_scans` gets a few added columns (Part B). |
| Item photos | The same signed `/images/<SKU>/…` URLs as Pick: the local listing photo first, then the eBay photo. |

## The packing process (as used today)
This is what the desktop does, and what the phone must do.

1. **Before packing:** every item is picked (Pick tab), and every shipping label has been bought on eBay or Shopify and printed.
2. **Load labels.** Fetch the labels bought in the last N hours (24 by default) from both eBay stores and Shopify.
   - This is safe to repeat. New orders are added, and orders already known get their tracking, cancelled flag and items refreshed.
   - Packed status and scans are never touched by a load.
   - This is the only step that calls eBay or Shopify. Opening the tab just reads the Mac's database.
3. **One record per order, for all time.** There are no sessions.
   - "Packed" belongs to the order, so a later load (or a load on the next day) never brings back a packed order as to-pack.
   - The **To pack** list is every loaded order that isn't packed, of any age. The 24 h window only decides what a load fetches.
   - **Packed** orders are listed for the last 7 days.
4. **Package = one shipping label (tracking number).**
   - With combined shipping, several orders from one buyer share a label. They are opened, scanned and packed together: "3 orders, one box", listed as `#1013 +2`.
   - Each item shows which order it belongs to.
5. **Scan the label and each item, in any order.** Every scan gets a sound and a colour.
6. **Bundles (`BUD-…`)** are already expanded into their component SKUs, each with its own photo. Scanning the bundle's own barcode ticks off all its components.
7. **Package complete:** once the label and every item are accounted for, the screen shows **"ALL n ITEMS ✓ — pack & stick the label"** and every order in the package is marked packed.
8. **Found it:** an item without a readable barcode is confirmed by hand. It counts like one scan and is recorded as a hand confirm.
9. **Mark packed:** a package packed outside the scan flow is marked packed by hand, after a confirmation. This covers orders with more than one label, or packing by hand. It's recorded as "marked by hand, not scan-verified".
10. **Undo** takes back the package's latest scan, hand confirm or Mark packed. A label scan or Mark packed is taken back on every order in the package. The package is no longer packed.
11. **Packages that must not go through the scan flow:**
    - **Cancelled or refunded** (any order in the package): red, "CANCELLED — do not ship". It stays in To pack until it is marked packed (i.e. dealt with).
    - **More than one label** on an order: orange, "pack it by hand, then Mark packed". These can't be scan-verified.
12. **Audit:** for a complaint, find the order (buyer, order ID or tracking) and read its scan record in order. It shows what was scanned or confirmed by hand, wrong items rejected, undos, and when it was packed.

## Scan rules
Each Enter-terminated scan is cleaned up with Pick's `normalizeScan`. For matching, both the scan and the tracking numbers are reduced to **letters and digits, upper-cased** (the `normalize` rule in `ops_console/packing.py`).

"The open package" is the package on the Package screen. On Pack home, no package is open.

Rules are checked in this order:

| # | Scan | Result | Recorded |
|---|---|---|---|
| 1 | **A label:** at least 8 characters, and equal to a package's tracking number, or ending with it when the tracking number has at least 10 characters (USPS barcodes put `420` + ZIP in front) | Opens that package, from any screen. The previous package keeps its progress. Then, by the package's state: **packed** → orange "already packed at 14:05 (marked by hand)"; **cancelled** → red "CANCELLED — do not ship …"; **several labels** → orange "pack it by hand, then Mark packed"; **now complete** → green "Label ✓ — ALL n ITEMS ✓ …"; otherwise → green "Label ✓ #1013 — 1/3 items. Scan the items." | `label` on every order in the package: `ok`, or `dup` if the label was already scanned **or the package is already packed** (the packer was just told; only a stale phone sends `ok` on a packed package, which the Mac reports as a conflict) |
| 2 | An item of the open package (packable and not packed) that still needs a unit | Counts one unit. Green "✓ SKU — in this package (2/3 items, label ✓)", or the complete message | `sku`, `ok`, on the order of the first incomplete matching item |
| 3 | An item of the open package that is already complete | Orange "SKU already scanned for #1013" | `sku`, `dup` |
| 4 | Any other item, while the open package has at least one scan | **Red "✗ SKU is NOT in #1013. It belongs to #1020."** Not counted. **The open package never changes on an item scan.** | `sku`, `wrong`, on the open package's first order |
| 5 | An item that exactly one other unpacked, packable package still needs | Counts there and opens that package. Green, plus "Scan its label to confirm" if its label isn't scanned yet | `sku`, `ok` |
| 6 | An item that several packages still need | Orange "SKU is in 3 orders (…) — scan the label first" | `sku`, `ambiguous`, no order |
| 7 | An item of a package where it's already complete | Orange "SKU is already accounted for in #1013" | `sku`, `dup`, no order |
| 8 | Anything else | Red "? TEXT — not a loaded label or an item of any order to pack. If it's a new label, load labels again." | `sku`, `unknown`, on the open package's first order (or no order) |

- A package is **packable** when it has exactly one label and no order in it is cancelled.
- A package is **complete** when it is packable, its label is scanned on every order, and every item has `count ≥ qty`.
- The moment a scan makes a package complete, all its orders get `packed_at`.
- An item scan "matches" an item when it equals the item's SKU, or (if no item has that SKU) the item's bundle SKU. All components of the bundle then match.
- When several items match, the unit goes to the first one not yet complete.
- Labels of orders packed more than 7 days ago are not on the phone. They fall under rule 8. This differs from the desktop, which looks those up in the database.

**Found it** (on an item that isn't complete) counts like rule 2, recorded as `manual`.

**Mark packed** (any package not yet packed) records `manual_packed` on every order and sets `packed_at`.

**Undo** finds the package's newest active `ok` record of kind `label`, `sku`, `manual` or `manual_packed`, **by its time (`at`)**, not its place in the list: a phone scan uploaded late sits after newer desktop scans in the Mac's list. Ties go to the later one in the list. For a `label` or `manual_packed`, every order's row with the same kind and the same second is taken back together, and every ref is sent.
- A record made on the desktop can be undone too. The confirmation says so: "Undo AAU-1109-012 (scanned on the desktop)?".
- If the package is no longer complete, its orders lose `packed_at`. If it is **still complete** (an item was counted on both sides), it stays packed, as on the Mac.
- An undo of records already undone (e.g. on the desktop) changes nothing.

**Packages with no items** can't complete by scan. They show "No items on this order — check it, then Mark packed".

**Items without a SKU** (eBay lines with none) are shown as "(no SKU)". They can't be scanned; Found it confirms them and sends `"sku": ""`.

## Hardware and labels
- Same iPhone and Eyoyo scanner (HID mode) as Pick. The phone camera is not used.
- **Item label** = the SKU (e.g. `AAU-1109-012`), or a bundle SKU (`BUD-…`).
- **Shipping label** = the carrier barcode: USPS (`420` + ZIP + tracking), UPS (`1Z…`), FedEx, or eBay Standard Delivery. A new carrier must be checked with a real scan before it's relied on.

---

# Part A — App requirements

## App structure
- Pack is a **new last tab**. The bottom nav is: **Shoot · Stow · Pick · Pack**.
  - Icon: `archivebox` (Pick already uses `shippingbox`).
  - Badge: the number of packages still to pack, not counting cancelled ones.
- Pack has two screens: **Pack home** and **Package**. A full-screen photo viewer opens from a Package photo.
- Switching tabs keeps each tab's state.
- Same UI kit and style as Pick and Stow:
  - `Card`, `Row`, `Pill`, `Button`, `ProgressBar`, `EmptyState`, `SectionHeader`
  - the tinted "Scanner ready" card, `ScanBanner`, and `MacHeaderButtons` (Mac status dot)
  - native `Alert` confirms and `ActionSheetIOS`
  - large titles, inset-grouped cards, and iOS semantic colours from `src/lib/theme.ts`

### Navigation
```
Pack home ──tap / scan──▶ Package ──scan another label──▶ (same screen, other package)
    ▲                      │   │
    └────────── back ──────┘   └─tap photo──▶ Photo viewer
```
- A scan on Pack home that opens a package (rules 1 and 5) pushes the Package screen.
- On the Package screen, a scan that opens another package switches the screen to it, without stacking screens.
- Going back to Pack home closes the package. Its progress is kept, and no package is open on home.

## UI screens

### 1. Pack home
```
┌────────────────────────────────────┐
│ Pack                     ● Mac  ⟳  │
├────────────────────────────────────┤
│  12 to pack          8 packed today│
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░              │
│  Labels loaded 09:14 (24 h) · 62   │
│  ✓ All scans sent                  │
├────────────────────────────────────┤
│  ▣ Scanner ready                   │
│    Scan a shipping label or an item│
├────────────────────────────────────┤
│ TO PACK · 12                       │
│ ◐ #1013 +2   Kim L.   2/5     ›    │
│ ○ 15391-68563  F&P    0/1     ›    │
│ ⚠ 15393-24533  F&P  CANCELLED ›    │
│ ⚠ 15400-11100  TTP  2 labels  ›    │
├────────────────────────────────────┤
│ ▸ PACKED TODAY · 8                 │
├────────────────────────────────────┤
│  📷 Shoot  📥 Stow  📦 Pick  🗃 Pack │
└────────────────────────────────────┘
```
- **⟳** opens an action sheet:
  - **Load labels (last 24 h)**: `GET /pack-state?load=1&hours=24`. It calls eBay and Shopify on the Mac, so it can take up to 2 minutes and shows progress.
  - **Load labels (last 72 h)**: the same, for after a weekend.
  - **Quick reload**: `?load=0`, which just reads the Mac's database.
  - Pull to refresh = Quick reload.
- **Summary card:**
  - "N to pack" (unpacked packages).
  - "packed today" count.
  - Progress bar: packed today / (packed today + packable packages to pack).
  - When the labels were last loaded, and the window.
  - Unsent scan count, as on Pick: "N scans not sent", or "All scans sent".
  - A load that failed or timed out shows its error in red. The rest of the screen still works from the last state.
- **To pack:** one row per package, oldest label first.
  - Status icon: `○` not started, `◐` started, `⚠` red for cancelled, `⚠` orange for several labels.
  - Title: package name (`#1013 +2` for combined).
  - Subtitle: buyer, short store (`F&P`, `TTP`, `Shopify`), and 🏷 if the label is scanned.
  - Trailing: a `Pill` with items done/total, or a red `CANCELLED` / orange `2 labels` pill.
  - Tap opens the package.
- **Packed today:** collapsible, with the same rows, newest first. Subtitle shows the time, plus "by hand" for Mark packed.
- **Empty states:**
  - Never loaded: "No labels loaded", with a **Load labels** button.
  - Mac unreachable and nothing cached: "Can't reach the Mac", with **Try again** and **Server settings**.
  - All packed: "All packed".

### 2. Package
```
┌────────────────────────────────────┐
│ ‹  #1013 +2                  2/5   │
├────────────────────────────────────┤
│ 3 orders, one box · Shopify        │
│ Kim L. — Austin, TX                │
│ USPS 9400 1000 0000 0000 0000 00   │
│ 🏷 Label ✓ scanned    bought 22:18 │
├────────────────────────────────────┤
│  ▣ Scan the label and each item    │
├────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐  │
│ │   [photo]    │ │ ✓ [photo]    │  │  green border when complete
│ │ AAU-1109-012 │ │ AAO-0811-024 │  │
│ │ title…       │ │ title…       │  │
│ │ order #1013  │ │ order #1014  │  │
│ │ ST-GAR-AAC-1 │ │ ST-GAR-AAA-2 │  │
│ │ ○ 0/1  Found │ │ ✓ 1/1        │  │
│ └──────────────┘ └──────────────┘  │
├────────────────────────────────────┤
│ [ Mark packed ]   [ ↶ Undo last ]  │
├────────────────────────────────────┤
│  📷 Shoot  📥 Stow  📦 Pick  🗃 Pack │
└────────────────────────────────────┘
```
- **Header:** the package name, with a `Pill` for items done/total (green when packed).
- **Package card:**
  - "N orders, one box" for a combined package, plus the store.
  - Buyer and city/state.
  - Carrier and tracking number (in groups of 4 when it's all digits).
  - Label state: "Label ✓ scanned" in green, or "Label not scanned yet" in orange.
  - When the label was bought.
- **Status panel** in place of the scanner card when the package can't be scanned:
  - **Complete or packed:** green, ✓ "Packed 14:05", plus "(marked by hand, not scan-verified)" when that applies.
  - **Cancelled:** red, "CANCELLED / refunded — do not ship".
  - **Several labels:** orange, "N labels on this order — pack it by hand, then Mark packed".
  - **No items:** orange, "No items on this order — check it on eBay or Shopify, then Mark packed".
  - Packed on the desktop shows "Packed 14:05 on the desktop".
- **Item cards:** photo, SKU (large), title, tags ("of bundle BUD-…", "order #1014" in a combined package), the box label, a count `○ 0/1` or `✓ 1/1`, and "✋ by hand" for a hand confirm.
  - Photos are as large as fit, so the item in hand can be compared:
    - **1 item:** full-width photo.
    - **2–4 items:** two columns.
    - **5 or more:** rows with a 96 pt photo.
  - Complete items get a green border and tint, and keep their full-colour photo.
  - Items stay in the same order as they become complete, so cards never jump.
  - **Found it** shows on items that aren't complete, when the package is packable and not packed. It asks for confirmation first.
  - Tapping a photo opens the full-screen viewer (pinch to zoom). A scan there is handled as usual and closes the viewer.
- **Buttons:**
  - **Mark packed** (shown when not packed): if the phone's state is more than 30 s old, it first reloads (waiting at most ~3 s; offline it goes ahead). If the package turns out to be packed already, an orange banner says so and nothing is asked. Otherwise the confirmation "Mark #1013 as packed without scanning? It is recorded as marked by hand (not scan-verified). Undo reverses it."
  - **Undo last scan** (shown when there is something to undo): confirmation naming what is undone ("Undo the label scan?", "Undo AAU-1109-012?", "Undo Mark packed?").

### 3. Scan feedback (banner)
`ScanBanner` with Pick's tones and `src/lib/pick/feedback.ts` sounds:

| Outcome | Banner | Sound and haptic |
|---|---|---|
| ok (label or item counted) | green | ding + success |
| **package complete** | green, "ALL n ITEMS ✓ — pack & stick the label" | double ding (`feedbackRepeat`) |
| dup, ambiguous, already packed, several labels, undo | orange | warning |
| wrong item, cancelled, unknown | red | error |

## Scanner input handling
As in Pick and Stow:
- Reuse `src/components/pick/ScanCapture.tsx`: a hidden focused field while a Pack screen is in front, scans trimmed and upper-cased, works with a pinyin keyboard active.
- Only the screen in front handles scans.
- Confirmation alerts turn scanning off while they are open.

## Offline behaviour
**Packing never waits on the network.**
- The last `GET /pack-state` is stored on the phone (`Documents/pack/state.json`). Every scan, confirm, Mark packed and undo is written to `Documents/pack/events.json` first, then sent in the background and retried until accepted.
- Retries happen every 30 s, and when the app becomes active.
- `Documents/pack/meta.json` holds this install's `install_id` and next `seq`.
- What the screens show = server state + this phone's events the server hasn't counted yet. This is the same "unreflected events" rule as Pick: an event counts as reflected once it was accepted before the state request started. Sending pauses during a refresh.
- Only **Load labels / Quick reload** need the Mac.

## Running alongside the desktop
The desktop Packing tab may be used at the same time (`parallel-run.md`).
- **Automatic quiet reload** (`load=0`) when a Pack screen comes to the front (unless reloaded in the last 5 s), when the app becomes active, every **30 s** while a Pack screen is in front, and right after a conflict. It shows no spinner and no error text; a failure just leaves the last state. If `server_version` is unchanged nothing is re-drawn. A reload never changes the open package or leaves the Package screen; if a later load gave the open package another key (an order joined it), the screen follows it.
- **Conflicts:** `POST /pack-events` may list `conflicts` (scans of a package already packed by the other side). Those events are accepted like the rest and never resent. The phone shows an orange banner, "#1013 was already packed on the desktop at 14:05 — your scan was not counted, check the box was not packed twice", with the warning sound, then reloads.
- **The open package packed by the desktop:** after a reload the Package screen shows the green "Packed 14:05 on the desktop" panel, with a one-time orange banner.
- **A load running on the Mac** (`load_running`, from either side): Pack home shows "Load labels still running on the Mac…" and looks again every 15 s until it ends. "Labels loaded" always shows the window that actually ran; if it differs from the one asked for on this phone (the request joined another load), Pack home offers **Load again (N h)**.
- Accepted events are kept on the phone for 30 days, then pruned.

---

# Part B — Server requirements
Pack runs on the **same fp_ops server as Pick, Stow and Shoot**. Endpoints sit alongside the existing ones, and how the server is reached doesn't change:
- Plain HTTP on the home Wi-Fi, with the same base URL and settings field.
- The same `Authorization: Bearer <EXPO_PUBLIC_PICK_TOKEN>`.
- The same `GET /health`.
- The same SQLite database (`DB_PATH`, `data/ebay_analytics.db`).

Server conventions follow the existing code:
- routes inline in `create_app`;
- `{"error": …}` with 400 only for a malformed request;
- `{accepted: […]}` for event batches;
- one connection per request;
- `events.write_lock` plus one transaction per batch;
- schema created at startup with `CREATE … IF NOT EXISTS` and `PRAGMA table_info`-guarded `ALTER TABLE … ADD COLUMN`.

**One copy of the Python rules.** The server reuses `ops_console/packing.py` (standard library only), by inserting its folder on `sys.path` the same way `packing_sync.py` does. That covers `ensure_schema`, `load`, `load_package`, `normalize`, `Package` and `items_matching`, so the desktop and the server work out progress and completion identically.

**Times.** The API always uses UTC ISO-8601 with `Z`. The `packing_*` tables keep the desktop's format, which is **local time without a zone** (`2026-11-10T14:05:31`), because the desktop's "today", "last 7 days" and report filters compare those strings. The server converts in both directions with `USER_TIMEZONE` (`settings.timezone`).

## Endpoints

### 1. `GET /pack-state?load=0|1&hours=24`
Everything the phone needs, loaded on Refresh and cached on the device.

- **`load=1`** runs Load labels first: `poetry run python ops_console/packing_sync.py --db <DB_PATH> --hours <hours>` from the repo root.
  - Reuse `fp_ops/resync.py`'s `Resyncer`, made to take its command, as a second instance with the same behaviour:
    - only one run at a time; a request that arrives during a run joins it;
    - wait at most ~110 s (under the app's 120 s timeout); after that, serve the current DB state and let the run finish in the background;
    - log to `fp_ops/data/logs/pack_load_<stamp>.log`.
  - `hours` is clamped to 1–168. Default 24.
- **`load=0`** reads the database only. It's fast.

```json
{
  "generated_at": "2026-11-10T14:00:00Z",
  "load_status": "no | ok | failed | timeout",
  "load_error": null,
  "last_load": { "loaded_at": "2026-11-10T09:14:02Z", "hours": 24, "orders_found": 66, "orders_new": 4 },
  "packages": [{
    "key": "shopify:6012345678901",
    "name": "#1013 +2",
    "store": "shopify",
    "buyer": "Kim L.",
    "ship_city": "Austin",
    "ship_state": "TX",
    "tracking": "9400100000000000000000",
    "tracking_norm": "9400100000000000000000",
    "carrier": "USPS",
    "label_time": "2026-11-10T06:18:44Z",
    "label_count": 1,
    "orders": [{
      "order_key": "shopify:6012345678901",
      "store": "shopify",
      "order_id": "6012345678901",
      "name": "#1013",
      "cancelled": false,
      "packed_at": null
    }],
    "items": [{
      "order_key": "shopify:6012345678901",
      "seq": 0,
      "sku": "AAU-1109-012",
      "parent_sku": null,
      "title": "…",
      "qty": 1,
      "room": "GAR",
      "box_id": "AAC-1",
      "box_label": "ST-GAR-AAC-001",
      "image_url": "http://…/images/AAU-1109-012/thumb.jpg?sig=…",
      "image_url_full": "http://…/images/AAU-1109-012/full.jpg?sig=…"
    }],
    "scans": [{
      "ref": "evt-uuid or scan:1234",
      "order_key": "shopify:6012345678901",
      "kind": "label | sku | manual | manual_packed",
      "sku": "AAU-1109-012",
      "at": "2026-11-10T13:58:02Z"
    }]
  }]
}
```

**Which packages and fields:**
- `packages` are `packing.load()`'s board: every package with an unpacked order (any age), plus packages packed in the last 7 days. To-pack packages come first, oldest label first.
- `key` is the package's first order key, as in `packing.Package`.
- `name` is the package name: `channel_name` or `order_id`, with `+N` for combined packages.
- Per order, `name` is that order's `channel_name` or `order_id`.
- `room` and `box_id` come from `packing_items`. `box_label` is the printed label from `fp_ops/boxes.py`, or null.
- `image_url` and `image_url_full` come from `images.image_urls(request.host_url, token, sku)`, or are null when there's no photo (`ImageStore.has_image`).

**`scans`:** the package's **active** rows from `packing_scans`, in `scan_id` order. Active means `result = 'ok'`, `kind != 'undo'` and `undone_at IS NULL`. These are the rows `packing._fill` counts. The phone works out item counts, label state, hand confirms and Mark packed from them, and undoes them by `ref`.
- `ref` is the row's `event_id` when it came from the phone, otherwise `scan:<scan_id>`.
- One phone event may own several rows (one per order), and they share the `ref`.

### 2. `POST /pack-events`
Uploads the pack log as a batch.
```json
{
  "device": "iPhone 11 / app 1.0.0",
  "install_id": "uuid created on first launch",
  "events": [{
    "event_id": "uuid (idempotency key)",
    "seq": 512,
    "at": "2026-11-10T13:58:02.123Z",
    "kind": "label | sku | manual | manual_packed | undo",
    "result": "ok | dup | wrong | ambiguous | unknown",
    "package_key": "package open or targeted (null if none)",
    "order_keys": ["shopify:6012345678901", "shopify:6012345678902"],
    "sku": "AAU-1109-012 (sku/manual/undo; null for label/manual_packed)",
    "raw": "raw scan text exactly as received (null for manual/manual_packed/undo)",
    "undoes": ["evt-uuid", "scan:1234"]
  }]
}
```
→ `{ "accepted": ["event_id", …] }`

**Request handling:**
- Events are applied in `seq` order, all in one transaction.
- An `event_id` already stored is accepted again and ignored.
- A business conflict never fails the request: the event is stored as sent, or the phone would retry forever. Examples are an event for an order that's already packed, or an undo of a row that's already undone. Only a malformed request or event gets an error. A malformed event is logged and left out of `accepted`, as in Pick.

**How each event is written** (exactly as the desktop writes it, so `ops_console/packing.py` reads it unchanged):

| kind | `packing_scans` rows | `raw` | `sku` | Then |
|---|---|---|---|---|
| `label` | one per `order_keys` entry | the scan | NULL | if `ok`: complete check |
| `sku` | one per entry; an empty `order_keys` gives one row with `order_key` NULL | the scan | the scan text | if `ok`: complete check |
| `manual` | one, on `order_keys[0]` | `(manual)` | the item SKU | complete check |
| `manual_packed` | one per entry | `(mark packed)` | NULL | set `packed_at` = event time on those orders where it is NULL |
| `undo` | for every row whose ref is in `undoes` and that isn't undone yet: set `undone_at` = event time, and insert an `undo` row on its order with `raw` = the undone row's `scan_id` | — | the undone row's `sku` | set `packed_at` = NULL on every order of the package |

**Columns written:**
- On each new row: `scanned_at` = the event's `at`, converted to local time; `kind`; `result`. Plus the added columns: `event_id`, `install_id`, `seq`, `device`, `received_at`, `undoes_ref`. `undoes_ref` is set on an `undo` row to the ref it undid.
- **Complete check:** re-read the package with `packing.load_package(conn, package_key)`. If `is_done` and not `packed_at`, set `packed_at` = the event's time (local) on all its orders. This is the desktop's `_finish_if_done`, applied in event time.

## Table changes (`packing_*`, main DB)
**No new tables.**
- `packing_orders`, `packing_items` and `packing_loads` are **unchanged**. Loads from the phone are ordinary `packing_sync.py` runs, so they write `packing_loads` as today.
- **`packing_scans` gets new columns**, all nullable, so the desktop's rows and inserts are unaffected:
  - `event_id TEXT`
  - `install_id TEXT`
  - `seq INTEGER`
  - `device TEXT`
  - `received_at TEXT` (server UTC)
  - `undoes_ref TEXT`
- **New index:** `CREATE UNIQUE INDEX … ON packing_scans(event_id, COALESCE(order_key, '')) WHERE event_id IS NOT NULL`. This is the idempotency key, and it allows one event to own one row per order.
- Rows are never deleted. `undone_at` is the only column ever updated, as on the desktop. Progress is always worked out from the active rows.

## Audit
### `GET /pack-audit`
Read-only JSON. Takes one of:
- `?order=<order_id or order_key>`
- `?tracking=<any form>`
- `?sku=`
- `?date=YYYY-MM-DD`
- `?check=integrity`

### Questions this must answer (acceptance)
- **Given an order, tracking number or buyer:** its package, its items, and every scan row in order. That covers label scans, item scans, hand confirms, wrong items rejected while it was open, undos and Mark packed, each with time, device (phone or desktop) and raw scan text. Also when it was packed, and how: by scans, by scans plus hand confirms, or marked by hand.
- **Given a SKU:** the orders it was packed in, and when.
- **Given a date:** the orders packed that day and how each was verified. This is the same content as the desktop's `packed_report_<day>.csv`. Also add `make -C fp_ops pack-report DATE=YYYY-MM-DD`, which writes that CSV through `packing.write_report`.
- **Integrity check** (`?check=integrity`), which should return nothing:
  - gaps in `seq` for any `install_id`;
  - orders with `packed_at` that are neither complete by their active scans nor marked by hand;
  - complete orders without `packed_at`.

## Notes carried over from the desktop (Load labels)
These are already handled in `packing_sync.py` and must not be lost if it is changed:
- **Order status can't find "label printed, not shipped yet".** Buying a label marks the order FULFILLED at once, so labels are found by **label purchase time**.
- **eBay rewrites `shippedDate`** to the carrier's acceptance scan. USPS label time comes from the Finances API `SHIPPING_LABEL` transaction, looked up per order with the `orderId:{…}` filter. A bulk purchase has no `orderId` in its body, so don't switch to the date-range listing.
- **eBay Standard Delivery (`ESUS…`)** has no purchase transaction (it's billed later as "Postpaid"). Its `shippedDate` isn't rewritten, so that is used.
- **Shopify:** the first live fulfillment's `createdAt` and `trackingInfo`. Only `read_orders` is needed.
- **Window:** eBay orders created in the last 5 days. A label bought for an older order is missed.
- **A label re-bought after packing is not flagged.** The tracking is refreshed, but the order stays packed. This is a known gap and stays out of scope.

---

## Out of scope
- Buying or printing shipping labels, and uploading tracking numbers.
- Scan-verifying orders with several labels.
- Flagging a label re-bought after the order was packed.
- An iPad layout.
- Cross-checking Pack against Pick (e.g. warning that an item was never picked). The data in both supports adding it later.
- Multiple users, and access from outside the home network, as with Pick.

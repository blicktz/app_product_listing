# Order Picking App — Requirements

## Goal
Replace the printed picking sheet with the phone (plus a Bluetooth barcode scanner). The app tells me which boxes have items to pick and what to take from each box, and checks each pick against the item's barcode. It also sends a reliable record of what has been picked to the Mac, where packing happens.

## Current manual workflow (what the app must support)
1. **Export**: on the Mac, run `make force-resync SOLD_LOOKBACK=7` in `ebay_seller_port`. This does three things:
   - Re-syncs eBay sold items for the last 7 days and syncs Shopify orders.
   - Runs `export-awaiting-shipment`, which writes `output/order_storage_location_<ts>.csv` and a picking-sheet PDF.
   - The sheet has one line per item, **sorted by box ID, then SKU**, with these columns:
     - No, store (2 letters), short order ID, date (MM-DD), title, SKU, qty, room, box
     - `NF` when the location is unknown
     - an empty **Picked** checkbox
2. **Print the sheet** and go to the warehouse.
3. **Work one column at a time.** Boxes with the same prefix (`AAC-*`, `AAB-*`, …) are stacked in one column, directly on top of each other.
   - I look at the column and start with whichever box that has items to pick is **on top**.
   - I pick everything from it, then move to the next box down that has items.
   - The stack order doesn't always match the numbering, so **I choose which box to start with**, not the sheet.
4. **Tick the checkbox** for each item picked. This record is essential.
5. **Item hard to find**: I read the title on the sheet to work out what it is. A photo would help, but paper can't show one.
6. **Packing** happens on the Mac, which already has its own packing tool. Packing relies on the pick record to tell "look in the packing area" (picked) from "still in the warehouse" (not picked).
7. **Rare: item not in its box.** I go back to the Mac and look for other items listed at the same time, then search their boxes.
   - The SKU `PREFIX-MMDD-NNN` encodes the listing batch (`PREFIX-MMDD`) and the sequence number (`NNN`).
   - The boxes holding the same batch, or nearby sequence numbers, are where a misplaced item most likely ended up.

### What the app improves
| Paper | App |
|---|---|
| Find the top box's lines in a list sorted by box ID | Scan the top box → see just its items |
| Tick by hand (possible to forget, or tick the wrong line) | Scanning the item's barcode is the tick, and a wrong item is rejected |
| Title only | Title + cover photo (tap to enlarge) |
| Walk back to the Mac to find "same-batch" boxes | Missing-item screen lists the nearby boxes right away |
| Ticks exist only on paper | Picks are sent to the Mac, where packing can see them |

## App structure
- Picking is the **second tab** of the existing app.
  - **Shoot**: the current home screen (`src/app/index.tsx`) and its flow.
  - **Pick**: new.
- Mobile layout with a **bottom tab bar** (expo-router `Tabs`).
- Full-screen screens hide the tab bar: camera, scan, listing config and upload queue stay pushed screens above the tabs.
- Switching tabs keeps each tab's state.
- The bottom nav has two buttons: **Shoot** and **Pick**. There are no tabs at the top of any screen.
- Pick has three screens:
  - **Columns** (Pick's home)
  - **Box** (items in one box)
  - **Can't find**

## UI screens
Mobile layout. The bottom nav is shown on every screen except the full-screen camera, scan, listing config and upload queue screens.

### Navigation
```
Shoot ──(nav)── Pick home ──scan/tap box──▶ Box ──all done──▶ Box done
                   │                         │                  │
                   │                         └─Can't find──▶ Can't find
                   └◀──────── scan next box ◀───────────────────┘
```
Scanning a box label on any Pick screen opens that box.

### 1. Shoot (existing home screen + bottom nav)
```
┌────────────────────────────────────┐
│  (current home screen, as today)   │
│                                    │
├────────────────────────────────────┤
│      📷 Shoot          📦 Pick      │
│      ━━━━━━━                       │
└────────────────────────────────────┘
```

### 2. Pick home: columns of boxes
```
┌────────────────────────────────────┐
│ Pick                    ● Mac  ⟳   │
│ Loaded 10:15 · 14 orders · 19 items│
│ 12 to pick · 1 missing · ↑2 unsent │
├────────────────────────────────────┤
│  ▣ Scan a box label to start       │
├────────────────────────────────────┤
│ AAC                         3 boxes│
│   AAC-3   ●●○   2 / 3        ›     │
│   AAC-7   ○     0 / 1        ›     │
│   AAC-12  ○○    0 / 2        ›     │
│ AAB                         1 box  │
│   AAB-12  ○     0 / 1        ›     │
│ Y                           2 boxes│
│   Y-4     ○     0 / 1        ›     │
│   Y-13    ○○    0 / 2        ›     │
│ ⚠ Unlocated                 1 item │
│   AAQ-0901-210  Hot Wheels Cl… ›   │
│ ── Done ─────────────────────────  │
│   TTT-11  ✓     1 / 1              │
├────────────────────────────────────┤
│      📷 Shoot          📦 Pick      │
│                        ━━━━━━      │
└────────────────────────────────────┘
```
- **Header**:
  - `● Mac`: green when the Mac is reachable, red when not. Tap it to edit the server URL.
  - `⟳` / pull-to-refresh reloads the pick list.
  - `↑N unsent`: pick events not yet sent to the Mac. It should be 0 before packing on the Mac.
- **Column groups**: each column is a box-ID prefix. Rows show a dot per item (● picked, ○ open) and a progress count.
- **Done**: finished boxes move here, greyed out.
- **Unlocated**: items with no box. Tap one to open its Can't find screen.

### 3. Box
```
┌────────────────────────────────────┐
│ ‹ Pick          AAC-3      2 / 3   │
│ Column AAC · Room GAR              │
├────────────────────────────────────┤
│ ┌────────┐ AAC-0621-001      ×1    │
│ │        │ Lenox Disney Frozen     │
│ │  img   │ Elsa Anna Porcelain     │
│ │  ⤢     │ Ornament                │
│ │        │ FO · #24533 · 11-08     │
│ └────────┘                         │
│ [ Can't find ]       [ Manual ✓ ]  │
├────────────────────────────────────┤
│ ┌────────┐ AAC-0702-030      ×2    │
│ │        │ Our Generation 18"      │
│ │  img   │ Doll Afro Puffs …       │
│ │  ⤢     │ SH · #81234 · 11-07     │
│ │        │ scanned 1 / 2           │
│ └────────┘                         │
├────────────────────────────────────┤
│ ✓ Picked                           │
│ ┌────┐ AAC-0623-008   ✓ 10:21  ↶   │
│ └────┘ Hot Wheels Cloak and Dagger │
├────────────────────────────────────┤
│     ▣ Scan item barcode…           │
├────────────────────────────────────┤
│      📷 Shoot          📦 Pick      │
└────────────────────────────────────┘
```
- **Open items** are on top. Each row shows:
  - image, SKU (large), title, qty
  - store (short) · short order ID · order date
- **Open-item images are large**: about 40% of the screen width (~140 pt square), so an item can be recognised without opening anything. Picked rows keep a small thumbnail.
- Tap any image to open the **Image viewer** (screen 3a).
- **Picked items** move to the bottom, with the pick time and `↶` (undo).
- **Manual ✓** confirms a pick without a scan, for an unreadable label.

### 3a. Image viewer (from Box or Can't find)
```
┌────────────────────────────────────┐
│ ✕                       1 / 1      │
│                                    │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ │                                │ │
│ │     full-resolution photo      │ │
│ │   pinch / double-tap to zoom   │ │
│ │     drag to pan when zoomed    │ │
│ │                                │ │
│ │                                │ │
│ └────────────────────────────────┘ │
│                                    │
│ AAC-0621-001                    ×1 │
│ Lenox Disney Showcase Frozen Elsa  │
│ Anna Snowflake Porcelain Ornament  │
└────────────────────────────────────┘
```
- Full screen on a black background, with no bottom nav.
- Close with `✕` or swipe down.
- Pinch to zoom up to about 4×, double-tap to toggle between 1× and 2.5×, and drag to pan while zoomed.
- The thumbnail shows first; the full-resolution image (`image_url_full`) replaces it once loaded.
- The SKU and full title are shown underneath, since titles are cut short in the Box rows.
- Scanning still works while the viewer is open. A matching scan closes it and records the pick.

### 4. Scan feedback (banner at the top of the Box screen)
```
 Match:
┌────────────────────────────────────┐
│ ✓ AAC-0621-001 picked · 1 left     │  green, ding + haptic
└────────────────────────────────────┘
 On the list, but listed in another box:
┌────────────────────────────────────┐
│ ⚠ AAO-0811-024 is listed in Y-13   │  orange
│   Picked it here from AAC-3?       │
│   [ No ]            [ Yes, pick ]  │
└────────────────────────────────────┘
 Not on the list:
┌────────────────────────────────────┐
│ ✕ G-0318-003 isn't in any order    │  red, buzz
└────────────────────────────────────┘
```

### 5. Box done
```
┌────────────────────────────────────┐
│ ‹ Pick          AAC-3      3 / 3   │
├────────────────────────────────────┤
│                                    │
│          ✓  AAC-3 done             │
│                                    │
│  Still to pick in column AAC:      │
│    AAC-7    0 / 1          ›       │
│    AAC-12   0 / 2          ›       │
│                                    │
│  ▣ Scan the next box               │
│                                    │
│  [ Back to all columns ]           │
├────────────────────────────────────┤
│      📷 Shoot          📦 Pick      │
└────────────────────────────────────┘
```

### 6. Can't find
```
┌────────────────────────────────────┐
│ ‹ AAC-3        Can't find          │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ │         large photo            │ │
│ │                                │ │
│ └────────────────────────────────┘ │
│ AAC-0621-001                    ×1 │
│ Lenox Disney Showcase Frozen Elsa  │
│ Anna Snowflake Porcelain Ornament  │
│ Order #24533 · listed 06-21        │
├────────────────────────────────────┤
│ Also listed in                     │
│   FRE-001                     ›    │
│ Same batch (AAC-0621) is in        │
│   AAC-4     -001/-020         ›    │
│   Z-2       -021/-040         ›    │
├────────────────────────────────────┤
│ Scan any box, then the item, to    │
│ pick it from there.                │
│                                    │
│ [ Mark missing… ]                  │
├────────────────────────────────────┤
│      📷 Shoot          📦 Pick      │
└────────────────────────────────────┘
```
- Tap the photo to open the Image viewer.
- **Also listed in**: `other_boxes`.
- **Same batch**: `nearby_boxes`, with the SKU range each box holds.
- **Mark missing…**: asks for an optional note, then records a `missing` event.

## Hardware
- iPhone 11 (iOS) with an Eyoyo back-clip 1D/2D Bluetooth scanner in **HID (keyboard) mode**, so each scan arrives as typed text followed by Enter.
- The phone camera is a fallback only.
- Barcodes in use:
  - **Item label** = the SKU (e.g. `AAO-0811-024`).
  - **Box label** = `ST-<room>-<column>-<box>`: a 3-letter room code (`GAR` garage, `SHD` shed), a 3-letter column, then a 3-digit box number (e.g. `ST-GAR-AAC-001`, `ST-SHD-ABA-002`).
    - The inventory (and the server's `box_id`) still uses older short IDs. The app converts each one to its printed label, using the `room` the server sends with the box, before comparing it with a scan:
      - A single-letter column becomes three of that letter, with or without a dash: `A-1` → `ST-GAR-AAA-001`, `Q1` → `ST-GAR-QQQ-001`.
      - A 3-letter column stays as it is: `AAB-10` → `ST-GAR-AAB-010`, `FRE-001` → `ST-GAR-FRE-001`.
      - The box number is padded to 3 digits.
      - Extra dashes are ignored: `K--7` → `ST-GAR-KKK-007`.
      - A sub-box shares its parent's label: `T-3-1`, `T-3-2` → `ST-GAR-TTT-003`.
    - Scanning the old ID typed by hand also still works.

## Picking flow
1. **Load** the pick list from the Mac (pull-to-refresh). Show when it was loaded, the number of orders, items and boxes, and items **not yet picked**.
2. **Columns** (home):
   - Boxes with items to pick are grouped by **column**: the box-ID prefix, i.e. everything before the last `-`.
   - Each column shows its boxes with item counts and progress (`AAC-3 · 2/3`).
   - Finished boxes and columns are greyed out and move to the bottom.
   - An **Unlocated** group lists items with no known box.
3. **Start anywhere: scan a box label** from any screen in the Pick tab, or tap a box, and its Box screen opens.
   - This is the main way in, because I start with whatever box is on top.
   - Scanning a box with nothing to pick shows "Nothing to pick in AAC-5".
4. **Box screen**: the items to pick from this box. Each row shows:
   - cover image, SKU (large), title, qty, and short order ID
   - Tap the image to enlarge it.
5. **Pick = scan the item barcode**:
   - **Match**: mark it picked, play a success sound and haptic, and show the remaining count.
   - **SKU on the list, but in a different box**: say so ("AAO-0811-024 is listed in Y-13"). The app asks before recording a pick from the wrong box, because the box data may simply be wrong.
   - **SKU not on the list**: error sound and haptic, and nothing is marked.
   - **Qty > 1**: each scan counts once, until the quantity is reached.
   - **Box done**: success cue, and the app shows the **remaining boxes in the same column**, so I can move to the next one down. Scanning the next box opens it directly.
6. **Undo**: tap a picked row to un-pick it.

## Can't find an item
On the item's row, a **Can't find** action opens a screen with:
- A large photo, the full title, and the SKU.
- **Other candidate boxes**: every box whose content range matches the SKU.
- **Nearby boxes**: boxes holding the same listing batch (`PREFIX-MMDD`), nearest sequence first. The server provides these, so no trip to the Mac is needed. Scanning any of these boxes and then the item records the pick normally.
- **Mark missing**, with an optional note. The item stays visible as unresolved and is reported back to the Mac.

## Other rules
- **Unreadable label**: "Confirm manually" on the row. It's recorded as `method: manual`.
- **Bundle items**: the server sends one line per component, shown as `BUNDLE:COMPONENT`, the same as the sheet. Each component is picked from its own box.
- **Pick list refresh**: existing picks are kept, new orders are added, and an item whose order vanished (cancelled or shipped) is flagged.
- **Short order ID**: shown the same way as on the sheet (the eBay segment after the last `-`, or the last 5 digits for Shopify), so the phone matches the order IDs on the printed sheet.

## Scanner input handling
- A hidden text field stays focused while the Pick tab is in front, and each Enter-terminated string counts as one scan.
- Scans are trimmed and upper-cased.
- A scan that matches a **box ID** opens that box. Anything else is treated as an **item SKU**.
- The app doesn't rely on the on-screen keyboard, which iOS hides while the scanner is connected. Search uses the scanner's keyboard toggle (double-press the trigger).
- Scans must still work if a Chinese (pinyin) keyboard is the active input. If they can't be made to work, the app shows a warning.

## Server communication (app ↔ Mac Studio portal)
Only what the app needs. How the server builds the data is handled in a separate thread.

### Connection
- Plain HTTP on the home Wi-Fi to the portal on the Mac Studio.
- Base URL: default from `EXPO_PUBLIC_PICK_SERVER_URL` (e.g. `http://<mac-name>.local:<port>`), editable in a settings field on the Pick tab.
- Every request sends `Authorization: Bearer <EXPO_PUBLIC_PICK_TOKEN>`, the same pattern as `src/lib/uploadApi.ts`, but a separate token.
- The iOS app needs:
  - **Local network access**: `NSLocalNetworkUsageDescription`.
  - **An ATS exception for plain HTTP on the LAN**: `NSAllowsLocalNetworking`.
- Show a connection status on the Pick tab, and test it with `GET /health`.

### Endpoints
1. **`GET /health`** → `{ ok: true }`.
2. **`GET /pick-list?lookback_days=7`** does the same work as `make force-resync SOLD_LOOKBACK=7`, then returns the rows of the picking sheet plus the extra fields.
   - This is slow (it calls eBay and Shopify), so use a ~2 min timeout and show progress.
   - Add `?resync=0` to skip the re-sync and return the current DB state quickly.
   ```json
   {
     "snapshot_id": "id of this pick list (see Data the server keeps)",
     "generated_at": "2026-11-09T10:15:00Z",
     "lines": [{
       "line_key": "order_id + custom_sku (same key the CSV --diff uses)",
       "store": "foundandprofound",
       "order_id": "24-15393-24533",
       "order_date": "2026-11-08",
       "buyer": "laa-arn-k8dtsvrshx",
       "sku": "AAU-1007-008",
       "title": "…",
       "qty": 1,
       "image_url": "https://i.ebayimg.com/… (~500 px, for rows)",
       "image_url_full": "https://i.ebayimg.com/… (full size, for the zoom viewer)",
       "room": "GAR",
       "box_id": "TTT-11",
       "other_boxes": ["…"],
       "nearby_boxes": [{ "box_id": "AAC-4", "range": "AAC-0621-001/020" }],
       "picked_qty": 0,
       "status": "open | picked | missing"
     }]
   }
   ```
   - `box_id` is `null` when unlocated (the sheet's `NF`).
   - `other_boxes`: further boxes whose range also matches the SKU.
   - `nearby_boxes`: boxes holding the same `PREFIX-MMDD` batch, nearest sequence first, each with the SKU range it holds (from the box's Content field).
   - `picked_qty` and `status` reflect events the server already received, so a reinstall or a second session starts from the right state.
3. **`POST /pick-events`** uploads the pick log as a batch.
   ```json
   { "device": "iPhone 11 / app version", "events": [{
       "event_id": "uuid (idempotency key)",
       "snapshot_id": "pick list the app was working from",
       "line_key": "…", "order_id": "…", "sku": "…",
       "expected_box_id": "box the pick list said",
       "box_id": "box that was open when it happened",
       "action": "pick | undo | missing | reject",
       "method": "scan | manual",
       "scanned_value": "raw scan text (always sent for reject)",
       "note": "optional",
       "at": "2026-11-09T10:20:31Z"
   }] }
   ```
   - `reject` = a scan that didn't match an item in the open box. The app sends it with no `line_key`, just to record wrong-item scans.
   → `{ "accepted": ["event_id", …] }`. The server ignores an `event_id` it has already seen.
   - A pick from a box other than the line's `box_id` tells the server the box data is wrong, so it can be fixed in `Inventory_locations.csv`.

### Behaviour
- **Images**: loaded straight from eBay's CDN and cached on the device.
  - On Refresh, the app downloads both sizes for every open line in the background, so zoom also works where the garage Wi-Fi is weak.
  - Old images are removed when their line leaves the pick list.
- **Picks never wait on the network**:
  - Each event is written to an on-disk queue first, the same pattern as `src/lib/uploadQueue/`.
  - The queue is sent in the background and retried until accepted.
  - The Pick tab shows how many events haven't been sent yet.
- **The last pick list and all picks are stored on the device**, so picking works even when the Mac can't be reached. Only Refresh needs the Mac.
- **Merging on refresh**: server state + local events not yet sent = what's displayed.

## Data the server keeps (for recall and audit)
Purpose: months later, I can answer the questions below without the paper sheet.
- Was this item picked? When, and from which box?
- What was I told to pick that day, and where?
- What went missing, and where did it turn up?
- Which box records are wrong?

Rules:
- Store in the portal's SQLite.
- Keep forever, since the data is tiny.
- Events are append-only and never edited or deleted. A correction is a new event, e.g. `undo`.

### 1. Pick-list snapshots: what the app was told
One row per `GET /pick-list` response, plus its lines.
- **Snapshot**:
  - `snapshot_id`
  - `generated_at`
  - `lookback_days`
  - `resync` (yes/no)
  - counts of orders, lines and unlocated items
- **Snapshot line**: `snapshot_id`, plus every line field exactly as served:
  - `line_key`, `store`, `order_id`, `order_date`, `buyer`
  - `sku`, `title`, `qty`
  - `room`, `box_id`, `other_boxes`, `nearby_boxes`

### 2. Pick events: what actually happened
One row per event received, stored exactly as sent:
- `event_id`, `snapshot_id`, `device`
- `line_key`, `order_id`, `sku`
- `expected_box_id`, `box_id`
- `action`, `method`, `scanned_value`, `note`
- `at` (phone time) and `received_at` (server time)

### 3. Line status: current state, derived
One row per `line_key`, always rebuildable from the events. It's what `GET /pick-list` returns.
- `picked_qty`
- `status`: `open | picked | missing`
- `picked_at`, `picked_from_box`, `method`
- `missing_note`
- `first_seen_at` (first snapshot that held this line)
- `last_seen_at` (last snapshot that held it)
- `closed_reason`: `shipped | cancelled`, from `orders_cache` once the order leaves awaiting-shipment

### 4. Location issues: feeds fixes to `Inventory_locations.csv`
A row is created automatically for each of these:
- a pick where `box_id ≠ expected_box_id`
- a pick of an unlocated item
- a `missing` event

Fields:
- `sku`, `expected_box_id`, `found_in_box` (null while missing)
- `event_id` (the event that raised it)
- `status`: `open | fixed | ignored`
- `fixed_at`, `note`

A later pick of a missing SKU fills in `found_in_box`.

### Questions this must answer (acceptance)
- Given a SKU or order ID: every line, every event on it (pick, undo, missing, reject), from which box, when, and on which device.
- Given a date: the snapshot(s) loaded, the items picked, the items still open, and the items missing.
- The open location issues, each with its expected box vs. the box it was found in, ready for CSV correction.
- Lines picked but never shipped, i.e. the order was cancelled after picking. This means the item has to go back to its box.

## Out of scope
- Packing of any kind, including a packing check, shipping labels and tracking upload. Packing is its own tab: see `docs/pack-app/requirements.md`.
- Editing box contents in the app.
- Multiple users.
- Access from outside the home network.
- The printed PDF stays available on the Mac as a fallback; the app doesn't replace that export.

## Open decisions
- **Which channels to include**: eBay stores and Shopify are what `force-resync` exports today. Facebook Marketplace is local pickup, so it may not need picking.

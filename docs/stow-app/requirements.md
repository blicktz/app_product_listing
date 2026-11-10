# Stow App — Requirements

## Goal
Record which storage box every newly photographed product goes into, using the phone and the Bluetooth barcode scanner. Today this step leaves no per-item record. Each stow must be recorded on the Mac so that it can be audited later, and so that Pick can send me to the exact box.

The workflow is now: **Shoot → Stow → Pick → Pack**.

Related: `docs/order-picking-app/requirements.md` ("the Pick doc"). Stow uses the same phone, scanner, box labels and server.

## Workflow (what the app must support)
1. Shoot all the products in a batch.
2. Find a box, either a new one or an existing one.
3. Stick a barcode label with the SKU on each product. Printing and sticking happen outside the app.
4. **Scan the box label** to open the box.
5. **Scan each item** and put it in the box. For several units of one SKU, either scan it once per unit, or scan it once and set the quantity on its row.
6. When the box is full, **scan another box label**. That box is now open, and the remaining items go into it.
7. Repeat until every product is stowed, then tap **Finish**.

The app has no list of what to expect. I decide when I'm finished. Forgotten items are caught afterwards by the batch check under [Questions this must answer](#questions-this-must-answer-acceptance).

## App structure
- Stow is a **new tab between Shoot and Pick**. The bottom nav is: **Shoot · Stow · Pick**.
- Switching tabs keeps each tab's state. An open box stays open.
- Stow has three screens: **Stow home**, **Open box** and **Session summary**.
- A **session** starts with the first box scanned and ends at Finish. A session survives an app restart, and the open box is restored from disk.

## UI screens
Mobile layout, in the same style as Pick. The bottom nav is shown on all three screens.

### Navigation
```
Stow home ──scan box──▶ Open box ──Finish──▶ Session summary ──Done──▶ Stow home
                         │    ▲
                         └────┘
                       scan another box
```

### 1. Stow home
```
┌────────────────────────────────────┐
│ Stow                    ● Mac  ⟳   │
│ ↑2 unsent                          │
├────────────────────────────────────┤
│  ▣ Scan a box label to start       │
├────────────────────────────────────┤
│ Recent sessions                    │
│   Today 14:10   3 boxes · 42 units │
│   11-07 09:32   1 box  ·  9 units  │
├────────────────────────────────────┤
│    📷 Shoot    📥 Stow    📦 Pick    │
│               ━━━━━━               │
└────────────────────────────────────┘
```
- `● Mac` and `⟳` work as on Pick home. `⟳` reloads `GET /stow-state`.
- `↑N unsent`: Stow events not yet sent to the Mac.
- Scanning an item here shows "Scan a box first".

### 2. Open box
```
┌────────────────────────────────────┐
│ ST-GAR-AAC-001  Existing    12 in  │
│ Session: 2 boxes · 21 units        │
├────────────────────────────────────┤
│ ✓ AAU-1109-012 stowed              │  green, ding + haptic
├────────────────────────────────────┤
│ AAU-1109-012  [×1]  14:21:08   ↶   │
│ AAU-1109-011  [×3]  14:21:01   ↶   │
│ AAU-1109-010  [×1]  14:20:52   ↶   │
│ …                                  │
├────────────────────────────────────┤
│ ▣ Scan item, or the next box…      │
│ [ Enter SKU ]          [ Finish ]  │
├────────────────────────────────────┤
│    📷 Shoot    📥 Stow    📦 Pick    │
│               ━━━━━━               │
└────────────────────────────────────┘
```
- **Header**: the printed label, a `New` or `Existing` tag, and how many units went into this box in this session.
- **Rows**: one per SKU, with quantity and latest time, newest first. There are no titles or photos, because Stow has no list to get them from.
- **Quantity `[×N]`**: starts at 1, and each repeat scan adds 1. Tap it to type a different number, minimum 1.
  - It opens an **in-app number pad**, because iOS hides the on-screen keyboard while the scanner is connected.
  - A scan while the pad is open closes the pad without changing the quantity, then is handled as normal.
- `↶` takes the whole row back, including all its units.
- A row created by a move shows `moved ×N` and has no quantity input.
- **Enter SKU**: for an unreadable label. Recorded as `method: manual`. As with search on Pick, typing uses the scanner's keyboard toggle (double-press the trigger).
- The tag is left out if `GET /stow-state` has never loaded.

### 3. Scan feedback (banner on the Open box screen)
```
 Stowed:
┌────────────────────────────────────┐
│ ✓ AAU-1109-012 stowed              │  green, ding + haptic
└────────────────────────────────────┘
 Scanned again in this box:
┌────────────────────────────────────┐
│ ✓ AAU-1109-012 ×2 · 2 in this box  │  green, distinct sound + haptic
└────────────────────────────────────┘
 Already recorded in another box:
┌────────────────────────────────────┐
│ ⚠ AAU-1109-012 is in ST-GAR-AAC-002│  orange
│   (3 units). Move them all here?   │
│   [ No ]         [ Yes, move all ] │
└────────────────────────────────────┘
 Not a SKU or box label:
┌────────────────────────────────────┐
│ ✕ Unrecognised barcode: X12        │  red, buzz
└────────────────────────────────────┘
```

### 4. Session summary
```
┌────────────────────────────────────┐
│ Stow finished               14:32  │
├────────────────────────────────────┤
│ ST-GAR-AAC-001             12 units│
│ ST-GAR-AAC-002              9 units│
│ ST-SHD-ABA-002             21 units│
│ ────────────────────────────────── │
│ 3 boxes · 40 SKUs · 42 units       │
│ 2 rejected · 1 moved               │
│ ↑0 unsent                          │
│                                    │
│ [ Done ]                           │
├────────────────────────────────────┤
│    📷 Shoot    📥 Stow    📦 Pick    │
└────────────────────────────────────┘
```

## Hardware and box labels
- Same iPhone and Eyoyo scanner in HID mode as Pick. The phone camera is a fallback only.
- **Item label** = the SKU (e.g. `AAU-1109-012`).
- **Box label** = the same printed labels as Pick: `ST-<room>-<column>-<box>`, e.g. `ST-GAR-AAC-001`, `ST-SHD-ABA-002`. The rules, including the conversion from old short IDs, are in the Pick doc's Hardware section and `src/lib/pick/boxLabel.ts`.

## Scan rules
Each Enter-terminated scan is cleaned up with Pick's `normalizeScan` (`src/lib/pick/scan.ts`), then classified in this order:

| Scan | Result | Event |
|---|---|---|
| Has the `ST-…` label shape | Opens that box. Any previously open box is closed without a separate step. An unknown label is a **new box** | `box_open` |
| An old short ID listed by `GET /stow-state` | Opens that box, using its printed label | `box_open` |
| SKU shape (Pick's `SKU_PATTERN`), no box open | Rejected: "Scan a box first" | `reject` |
| SKU shape, box open, not recorded anywhere | Stowed, 1 unit | `stow` |
| SKU shape, already in the open box | 1 more unit | `stow` |
| SKU shape, recorded in a different box | Prompt: "Move them all here?" Yes moves the SKU and all its units here, No leaves it where it was | `stow` with `moved_from_box`, or `move_declined` |
| Quantity set on a row (not a scan) | Row changes to the typed number | `adjust` |
| Anything else | Rejected: "Unrecognised barcode" | `reject` |

- **A SKU has a unit count and lives in one box.** Scanning it twice means quantity 2. Its units are never split across boxes, which is why a different box prompts for a move of all units.
- A repeat scan has its own sound and the banner shows the new quantity, so an accidental double scan is noticed and can be corrected on the row.
- After a move, scanning the SKU again adds units in the normal way, on a new row.
- "Anything else" is stricter than Pick, where unknown text is treated as a box. Stow has no list to catch a misread, so unrecognised text must not open a box or be stowed.
- An old short ID that the server doesn't list is rejected, because the app can't tell which room it's in.
- A scan of a box that's already open does nothing and records nothing.
- "Recorded in a different box" is checked against this phone's own events plus the last `GET /stow-state`. The server also checks every stow when it arrives. See [Location table changes](#location-table-changes-stow-and-pick).
- **Undo** (`↶`) records one `undo` event for the row, with the row's units. Undoing a move puts the SKU and all its units back on record in its previous box.

## Scanner input handling
As Pick: a hidden text field stays focused while the Stow tab is in front, scans are trimmed and upper-cased, and scans must still work with a Chinese (pinyin) keyboard active. Reuse `src/components/pick/ScanCapture.tsx`. Only the tab in front handles scans.

## Offline behaviour
**Stowing never waits on the network**, the same as Pick:
- Each event is written to an on-disk queue first, then sent in the background and retried until accepted.
- Everything on Open box works with the Mac unreachable.
- Stow home shows how many events haven't been sent. It should be 0 before relying on the record.

## Server requirements
Stow runs on the **same Mac Studio portal as Pick**, as new endpoints alongside `/pick-list` and `/pick-events`. How the portal is reached is unchanged from the Pick doc:
- Plain HTTP on the home Wi-Fi, with the same base URL and settings field.
- The same `Authorization: Bearer <EXPO_PUBLIC_PICK_TOKEN>` token.
- The same `GET /health`.
- The same SQLite database.

### Endpoints

#### 1. `POST /stow-events`
Uploads the stow log as a batch.
```json
{
  "device": "iPhone 11 / app version",
  "install_id": "uuid created on first launch",
  "events": [{
    "event_id": "uuid (idempotency key)",
    "session_id": "uuid of the stow session (null for a reject scanned with no session open)",
    "seq": 1841,
    "action": "box_open | stow | adjust | undo | move_declined | reject | session_end",
    "box_label": "ST-GAR-AAC-001 (box open when it happened, null if none)",
    "sku": "AAU-1109-012 (null for box_open, session_end and an unclassifiable reject)",
    "units": "stow: 1 (null for a confirmed move). adjust: signed change, e.g. 4 for ×1 → ×5. undo: units taken back",
    "moved_from_box": "box it was recorded in, for a confirmed move or move_declined",
    "undoes_event_id": "undo only: the row's most recent stow or adjust, or the move being undone",
    "method": "scan | manual",
    "scanned_value": "raw scan text, unmodified (null when not from a scan)",
    "note": "optional",
    "at": "2026-11-09T14:21:08Z"
  }]
}
```
→ `{ "accepted": ["event_id", …] }`

- An `event_id` already seen is accepted again and ignored.
- An event is listed as accepted only after it and its location changes are committed in **one transaction**.
- `seq` goes up by exactly 1 for every event on this install, across sessions and restarts. It's how the audit proves nothing was lost.
- A business conflict never fails the request, or the phone would retry forever. The event is stored and a location issue is raised. Only a malformed request gets an error status.

#### 2. `GET /stow-state`
What the phone needs to label boxes and detect moves. Loaded on Refresh and cached on the device.
```json
{
  "generated_at": "2026-11-09T14:00:00Z",
  "boxes": [{ "box_id": "A-1", "room": "GAR", "label": "ST-GAR-AAA-001" }],
  "locations": [{ "sku": "AAU-1109-012", "box_label": "ST-GAR-AAC-001", "units": 3 }]
}
```
- `boxes`: every box the location table holds or has ever held, so a box emptied by picking is still `Existing`.
- `locations`: every SKU currently in the location table, with its box and units.

#### 3. `GET /stow-audit`
Read-only. Answers the acceptance questions as JSON. Takes one of:
- `?sku=AAU-1109-012`
- `?box=ST-GAR-AAC-001`
- `?session=<session_id>`
- `?date=2026-11-09`
- `?batch=AAU-1109`
- `?check=integrity`

### Location table changes (Stow and Pick)
**This changes the existing portal, including Pick's server behaviour.**

The portal already has a database table imported from `Inventory_locations.csv`. From now on, this **location table is the single live record of where items are and how many units of each SKU there are**. Each SKU is in one box. Stow adds to it, and Pick subtracts from it.

1. **Read from the table.** `GET /pick-list` (`box_id`, `other_boxes`, `nearby_boxes`) and `export-awaiting-shipment` must resolve locations from the location table.
2. **A `stow` adds its `units`** to that SKU in that box, creating the row if needed.
   - **A confirmed move** (`moved_from_box` set) moves the SKU's row, with all its units, to the new box. The count doesn't change.
   - **A stale phone**: if the SKU is recorded in another box but the event has no `moved_from_box`, the existing units move to the new box, the event's `units` are added, and a location issue is raised. A SKU never ends up with rows in two boxes.
3. **An `adjust` adds its signed `units`** to the SKU's count. A stow `undo` subtracts its `units`, or returns the SKU and all its units to the previous box if it undoes a move.
4. **Picking subtracts the order's quantity from the SKU's unit count.** The app sends one `pick` event per unit scanned, so **each `pick` event subtracts 1**, and a fully picked line has subtracted its `qty`.
   - The unit comes off the SKU's one row, including for a pick from an unexpected box. That pick still raises Pick's location issue.
   - A row is deleted when its count reaches 0. A SKU with units left stays in its box and on later pick lists.
   - The count never goes below 0. A pick that finds no unit to subtract changes nothing and raises a location issue, except for an item that was already unlocated.
   - Bundle lines use the component SKU, the part after `:`.
5. **A pick `undo` adds 1 back** to the box that pick subtracted from, recreating the row if needed. The app sends one `undo` per unit. An `undo` that only clears a `missing` mark changes nothing, and a `missing` event subtracts nothing.
6. **Returning an item** after a cancelled order is an ordinary stow, which adds its units back.
7. **Re-importing `Inventory_locations.csv` must not undo any of this.** The CSV becomes a one-time seed of the table, or the import becomes a merge that respects later changes. A plain re-import would bring back picked items and erase stowed ones.
8. **Fixes from location issues** (Pick doc, "Location issues") are now applied to the location table, not by hand-editing the CSV.

**The table must hold one row per SKU, with its box and a unit count.** The CSV's Content field stores ranges and lists (`G-0318-002/004`), and a count can't be kept against a range, so ranges must be expanded into per-SKU rows. Check this against the current table schema. Each row needs `units`, its source and the event that created it.

**Seeding unit counts for existing stock.** The CSV has no counts, so the seed import takes them from the **listing quantity**:
- A listing's available quantity has already gone down for orders that are sold but not yet picked, and those picks will subtract again. So the seed must be **listing available quantity + units on open pick lines** at import time.
- The full count goes on one box, the one `GET /pick-list` reports as `box_id`. Quantities are never split.
- If overlapping CSV ranges put a SKU in several boxes, the other boxes stay as `other_boxes` candidates with no units, and a location issue is raised so the record can be cleaned up.
- If no listing is found for a SKU, `units` is null. A pick then leaves that row in place, because subtracting from an unknown count could lose track of the remaining units. A row stowed through the app always has a count.

**Box identity.** New rows store the printed label as the box ID, with the room taken from the label. An old ID and its printed label are the same box (`A-1` and `ST-GAR-AAA-001`), so the server must apply the Pick doc's conversion and must never present them as two boxes. Sub-boxes share a printed label (`T-3-1`, `T-3-2` → `ST-GAR-TTT-003`), so a stow into that label is recorded at label level.

## Data the server keeps (for recall and audit)
Purpose: months later, I can prove where an item went, when and how, without relying on memory.

Rules:
- Store in the portal's SQLite, in **tables separate from the pick tables**.
- Keep forever.
- Events are append-only and never edited or deleted. **Database triggers abort any UPDATE or DELETE** on the stow event and ledger tables. A correction is a new event, e.g. `undo`.

### 1. Stow events: what actually happened
One row per event received, stored exactly as sent, including rejects and quantity adjustments:
- every field of the event in `POST /stow-events`
- `device`, `install_id`
- `received_at` (server time)

### 2. Stow sessions: derived
One row per `session_id`, always rebuildable from the events:
- `started_at`, `ended_at`
- boxes used, and counts of SKUs, units, quantity adjustments, rejects and moves
- `status`: `finished`, or `unfinished` when no `session_end` has arrived

### 3. Location ledger: every change to the location table
One row for each add or remove, from any source:
- `sku`, `box_id`, `room`
- `change`: `add | remove`
- `units`: how many units were added or removed (null for an import with no known count)
- `units_after`: the box's count for that SKU after the change
- `source`: `import | stow | pick | fix`
- `event_id` (the stow or pick event that caused it, null for an import)
- `at`

The ledger is append-only too. Together with the seed import, the events must be able to **rebuild the location table** by replaying them in `at` order. Any current location can then be traced back to what caused it.

### 4. Location issues
Uses Pick's location issues table (Pick doc, "Location issues"), with new kinds raised by Stow:
- `stow_conflict`: a stow of a SKU recorded in another box, where the phone hadn't known. Includes the old box, the new box and the `event_id`.
- `move_declined`: a move was refused, so the physical location needs checking.

### Questions this must answer (acceptance)
- **Given a SKU**: every stow, quantity adjustment, move, undo, pick and pick undo, with the box, time and device, and its box and unit count now.
- **Count check**: SKUs whose unit count differs from listing available quantity + units on open pick lines. This catches a wrong quantity typed or scanned at stow time.
- **Given a box**: what it holds now with unit counts, and everything that ever went in or came out.
- **Given a session or date**: the boxes used, the SKUs and units stowed in each, and every quantity adjustment, reject and declined move.
- **Given a batch (`PREFIX-MMDD`)**: the SKUs stowed, their boxes, and **gaps in the sequence numbers** (`NNN`). Since there's no expected list, this is the main way to spot a forgotten item.
- **Integrity check** (`?check=integrity`), which should return nothing:
  - gaps in `seq` for any `install_id`
  - sessions still unfinished
  - rows in the location table that the ledger can't explain, or whose `units` don't match the ledger

## Out of scope
- Printing or generating SKU and box labels.
- A list of expected products per batch.
- A later physical check that rescans a box against its record. The data here supports adding it.
- Pack.
- Multiple users, and access from outside the home network, as with Pick.

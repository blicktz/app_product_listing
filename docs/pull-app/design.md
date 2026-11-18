# Pull (dispose) tab: app design

Status: 2026-11-17, revision 4. Matches `fp_ops/docs/end-and-pull-requirements.md` **revision 5**. Implemented in the app (§6).
("the requirements"; `§n` = its sections). Earlier review and decisions: `docs/pull-app/requirements-review.md`.

---

## 1. Summary

- **Pull gets its own tab,** the 5th one, after Pack: `Shoot · Stow · Pick · Pack · Pull`. It is never next
  to Pick.
- **It works like Pick:** load the list, work box by box, scan the box label, then scan each unit. Can't
  find, Mark missing and manual confirm work as in Pick.
- **Differences from Pick (from the requirements):**
  - **Online only.** Each scan is one request, and it counts only once the Mac accepts it. With no Mac,
    scanning is off. There is no offline queue (§5.3, §6.2).
  - **One line per SKU.** A line can cover several ended listings or bundle members (§5.2).
  - **One scan = one unit.** A line with an unknown count ends with **"No more in this box"** (`finish`).
  - **`missing` closes the line** (§5.3). **Undo** is only for a wrong scan, and asks for a reason (§5.4).
  - **Nothing goes back to a box.** There is no "Put back" section: disposal is final, and only listings
    already off sale everywhere reach the list.
- **Separate code and data:** its own routes, store, scan handler, folder on disk, image cache, endpoints
  and badge. No Pick code path ever sees a pull line.
- **It looks different on purpose:**
  - a **purple** accent (`systemPurple`) where Pick uses blue
  - the tab icon `xmark.bin`
  - a `PULL · DISPOSE` strip on every Pull screen
  - "Pull" as the verb everywhere, never "pick"
  - its own success sound

---

## 2. Separation from Pick

| Concern | Pick (unchanged) | Pull (new) |
|---|---|---|
| Tab / routes | `src/app/(tabs)/pick/…`, `/pick-image` | `src/app/(tabs)/pull/…`, `/pull-image` |
| State on disk | `Documents/pick/` | `Documents/pull/`: `state.json` (last list + server answers), `pending.json` (the one unanswered event), `rejects.json` (refused scans, sent in the background) |
| Store, derive, scan logic | `src/lib/pick/*` | `src/lib/pull/*` (own module, own types) |
| Server endpoints | `GET /pick-list`, `POST /pick-events` (batched, offline) | `GET /pull-list`, `POST /pull-event` (one at a time, online) |
| Event actions | `pick · undo · missing · reject` | `pull · finish · missing · undo · reject` |
| Image cache | `pick-images/` | `pull-images/` (same `createImageCache`) |
| Tab badge | units to pick | lines to pull (§5.4) |
| Accent / sound | blue / `ding` | purple / new `pull` sound |

- **Scans can't cross over.** A scan is handled by the screen in focus (`ScanCapture` is mounted per screen).
  On a Pull screen it can only reach `pull/store.sendEvent`.
- **The phone doesn't read the Pick list at all any more.** The server checks open orders (§6.1 of the
  requirements).
- **Shared:** only things with no picking state:
  - the Mac address and online status (`pick/store.getSnapshot()`, as Stow and Pack do)
  - `boxLabel.ts`, scan normalisation, `feedback.ts`
  - `ScanCapture`, `ScanBanner`, `ui.tsx`
  - `PickImage`, generalised to take a URI and a viewer route

---

## 3. Screens

```
Pull home ──scan box / tap box──► Box ──Can't find──► Can't find
    │                              │
    └──tap unlocated line──────────┴──tap photo──► Image viewer (/pull-image)
```

### 3.1 Pull home

```
┌──────────────────────────────────────┐
│                         🖥️•    ⟳     │  Mac status · Reload
│ Pull                                 │
│ ▓▓ PULL · DISPOSE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  purple strip
│ ┌──────────────────────────────────┐ │
│ │ 41  lines to pull    12 of 53 done │
│ │ ██████░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │  purple bar
│ │ 47+ units · 30 boxes · 2 missing  │ │
│ │ Loaded 09:42 · 🟢 Mac connected    │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ⌗  Scanner ready (Pull)          │ │  purple card
│ │    Scan a box label to start     │ │
│ └──────────────────────────────────┘ │
│ COLUMN AAC · 3 BOXES                 │
│ ┌──────────────────────────────────┐ │
│ │ ○  AAC-3                    0/2 ›│ │
│ │    2 lines · GAR                 │ │
│ │ ◐  AAC-7                    1/3 ›│ │
│ │    3 lines · 1 done · GAR        │ │
│ └──────────────────────────────────┘ │
│ UNLOCATED · 1 LINE          (orange) │
│ ┌──────────────────────────────────┐ │
│ │ [img] FRE-0412-003             › │ │
│ └──────────────────────────────────┘ │
│ DONE · 4 BOXES ›                     │  collapsed; lines finished this load
└──────────────────────────────────────┘
  Shoot   Stow   Pick   Pack  [Pull 41]
```

**Offline.** The last list stays visible so the picker can plan, but the scanner card turns grey and every
pull button is disabled:

```
│ ┌──────────────────────────────────┐ │
│ │ ⌁  Pull needs the Mac            │ │  grey card, scanner off
│ │    Can't reach 192.168.1.20.     │ │
│ │    [ Try again ]  [ Server… ]    │ │
│ └──────────────────────────────────┘ │
```

- Box progress is lines done out of lines. For a line with a known count, units show inside the box screen.
- "47+ units" adds up the known counts. The `+` shows that some lines have an unknown count.
- **Loading.** Reload and pull-to-refresh fetch `GET /pull-list`. The Mac syncs orders first (§5.2), so it
  can take as long as Pick's full sync:
  - the request waits up to 2 minutes, and the card shows "Syncing orders on the Mac…"
  - lines that became held, cancelled or complete drop off, and new ones appear
  - lines completed on this phone stay under Done until the next reload, so they can still be undone (§6.2)
- **Order sync failed** (`orders_not_synced`). No list is served. The phone shows a blocking card, and the
  scanner turns off. **The old list stays visible but can't be used for pulling** (see §7, item A):

```
│ ┌──────────────────────────────────┐ │
│ │ ⚠  Orders couldn't be synced     │ │  orange card, scanner off
│ │    Pulling is paused until the   │ │
│ │    order sync works again.       │ │
│ │    [ Try again ]                 │ │
│ └──────────────────────────────────┘ │
```

### 3.2 Box

```
┌──────────────────────────────────────┐
│ ‹            AAC-7            [1/3]  │
│ ▓▓ PULL · DISPOSE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ┌──────────────────────────────────┐ │
│ │ Column AAC · GAR     1 of 3 done  │ │
│ │ Label ST-GAR-AAC-007             │ │
│ │ ███████████░░░░░░░░░░░░░░░░░░░░░ │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ⌗  Scan each unit to pull it     │ │
│ └──────────────────────────────────┘ │
│ TO PULL · 2                          │
│ ┌──────────────────────────────────┐ │
│ │ ┌────────┐ AAC-0621-004  [2 of 3]│ │  known count
│ │ │ photo  │ Mid-century ceramic   │ │
│ │ │ 128px  │ vase, blue glaze…     │ │
│ │ └────────┘ 2 listings · decided  │ │  several End actions on one SKU
│ │            11-12                 │ │
│ │ [🔍 Can't find] [✓ Pull 1 by hand]│ │
│ │ [ No more in this box ]          │ │  finish: shortfall becomes missing
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ┌────────┐ AAC-0621-009  [3 · ?] │ │  unknown count: scanned so far
│ │ │ photo  │ Brass candle holder…  │ │
│ │ └────────┘ BUD-0101 member ·     │ │  bundle member
│ │            decided 11-14         │ │
│ │ Count not on record: scan every  │ │
│ │ unit, then tap No more.          │ │
│ │ [🔍 Can't find] [✓ Pull 1 by hand]│ │
│ │ [ No more in this box ]  (purple)│ │  the main action for this line
│ └──────────────────────────────────┘ │
│ DONE · 1                             │
│ ┌──────────────────────────────────┐ │
│ │ [img] ✓ AAC-0621-002  1/1  09:51 │ │
│ │       Glass paperweight…    ⋯    │ │  ⋯ = Undo a wrong scan (rare)
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- **Every button sends one event and waits for the answer.** While it waits, the card shows a spinner and
  the buttons are disabled.
- **"Pull 1 by hand"** (manual confirm) asks first: "Pull 1 unit without scanning? It will be disposed of."
- **"No more in this box"** (`finish`) asks first. With a known count it says how many will be recorded
  missing: "Finish with 2 of 3? 1 unit will be recorded missing." With an unknown count: "Finish with 3
  units?"
- **Undo** is hidden behind `⋯` because it's rare. It works on any line of the current round, including
  lines under Done.
  - The server always reverses the line's **latest** accepted event (§5.3), so the menu names it: "Undo
    last pull (1 unit)", "Undo Mark missing" or "Undo No more in this box".
  - It asks for a reason (a required text field, with quick picks "Wrong item scanned", "Scanned twice"
    and "Tapped by mistake"), and sends `undo` with the reason as `note`.
  - When undoing a `missing` or `finish` reopens the line, it moves back to To pull, using the line in the
    reply.
- Missing and finished lines both appear under **Done**, marked `✓`, `⚠ missing` or `⚠ 2 of 3`.
- When every line is done, the box shows Pick's done panel ("AAC-7 done · 2 more boxes in column AAC" and a
  list of the column's remaining boxes).

### 3.3 Scan feedback

There is **one event in flight at a time**:

```
⏳  AAC-0621-004 · sending…                  (purple, no sound yet)
✅  AAC-0621-004 pulled · 1 left             (green, pull sound)
✅  AAC-0621-002 pulled · line done · 2 left in AAC-7
⚠️  AAC-0621-009 is listed in TTT-11         (asks before sending)
    Pulled it here from AAC-7?      [No] [Yes, pull]
⛔  AAU-1007-008 is on an open order        (red, error sound; server reject, safety net)
    Not counted. Leave it in the box.                  [OK]
⛔  AAC-0621-011 isn't on the pull list      (red; local reject, recorded as `reject`)
⛔  Not counted: listing's End was cancelled (red; server reject)
⚠️  AAC-0621-002 is already done             (orange)
⚠️  Nothing to pull in TTT-20                (box scan)
⛔  Not counted: no answer from the Mac       (red, with [Retry]; same event ID)
```

- A scan that arrives while another is in flight is **ignored**, with a short warning buzz and "Wait for
  the last scan". It is never queued silently: the picker has to see each unit counted.
- A timeout retries the **same event ID** (safe, §5.3), so the server's answer is final. The picker sees
  "Not counted" until it is accepted.
- The line changes only on an accepted answer, using the counts the server returns (§4).

### 3.4 Can't find

The same screen as Pick's: the photo, "Also listed in" (candidate boxes, §5.4), and nearby same-batch boxes.
**Mark missing** asks: "Mark missing? This closes the pull for N listings." It takes an optional note, and
the line moves to Done as `⚠ missing`.

### 3.5 Image viewer

`/pull-image`: Pick's zoom viewer with a purple badge. A scan there pulls from the box it was opened from.

---

## 4. Data contract proposal (for fp_ops)

### `GET /pull-list`

```json
{
  "snapshot_id": "…",
  "generated_at": "2026-11-17T09:42:00Z",
  "lines": [{
    "line_key": "AAC-0621-004#r1",
    "sku": "AAC-0621-004",
    "title": "…",
    "actions": [
      { "action_id": 123, "item_id": "1234567890", "store": "foundandprofound", "bundle_sku": null },
      { "action_id": 140, "item_id": "1234567999", "store": "foundandprofound", "bundle_sku": "BUD-0101" }
    ],
    "image_url": "…", "image_url_full": "…",
    "room": "GAR", "box_id": "AAC-7",
    "other_boxes": [], "nearby_boxes": [{ "box_id": "AAC-4", "range": "AAC-0621-001/020" }],
    "units_to_pull": 3,
    "pulled_qty": 2,
    "status": "pending | partly_pulled",
    "decided_at": "2026-11-12T20:11:00Z"
  }]
}
```
- `units_to_pull: null` means the count isn't on record.
- A SKU on an open order is never on the list (§7, item 3), so a line has no open-order field.

### `POST /pull-event` (one event per request)

```json
// request
{ "device": "iPhone 11 / app 1.4.0", "event": {
    "event_id": "uuid", "snapshot_id": "…",
    "line_key": "AAC-0621-004#r1", "sku": "AAC-0621-004",
    "expected_box_id": "AAC-7", "box_id": "AAC-7",
    "action": "pull | finish | missing | undo | reject",
    "method": "scan | manual", "scanned_value": "AAC-0621-004",
    "note": null, "at": "2026-11-17T09:51:02Z" } }

// response
{ "event_id": "uuid", "accepted": true,
  "reason": null,
  "line": { "line_key": "…", "pulled_qty": 3, "units_to_pull": 3,
            "status": "pulled | partly_pulled | missing | pending", "complete": true } }
```

- On a reject, `accepted` is false and `reason` is one of: `action_cancelled`, `needed_for_order`,
  `line_complete`, `not_on_list`, `held`, `old_round`, `nothing_to_undo` (§5.3).
- For a code it doesn't know, the app shows "Not counted: the Mac refused it (code)".
- `GET /pull-list` can fail with `orders_not_synced` (§5.2). The app shows the order-sync card (§3.1).
- The app shows each reason in its own words, so it needs these as fixed codes, not free text.
- A repeated `event_id` returns the same answer.

---

## 5. App behaviour details

1. **Store** (`src/lib/pull/store.ts`):
   - Keeps the last list on disk only so it can be viewed offline, plus the server-confirmed line states.
   - No event queue. Events go out one at a time, each with its own ID.
   - The event being sent is kept in memory, and on disk while unanswered, so a crash mid-request can retry
     the same ID on the next launch. It is never counted until accepted.
2. **Online and order-sync check:** Pull can be used only when both of these hold:
   - **The Mac is reachable.** The existing `/health` check, plus any failed event request, marks it
     offline.
   - **The latest order sync succeeded.** This comes from `orders_sync` in `/health`, from the list load,
     and from event replies (§7 A).

   Otherwise the scanner and every pull button are off, and the card on Pull home says which of the two is
   the problem.
3. **Rejects of local scans** (not on the list, box with nothing to pull) are also sent as `reject` events,
   as in Pick. Because the app is online, they arrive right away.
4. **Badge:** the number of lines still to pull. Lines are used because a line with an unknown count has no
   unit total. This answers open decision §11-2.
5. **Pull sessions:** not needed. The device and time on each event are enough. This answers §11-3.

---

## 6. Code (as built)

**New**
- `src/lib/pull/`
  - `types.ts`, `api.ts`
  - `store.ts`: online only; one event at a time; order-sync state; refused scans recorded in the
    background
  - `derive.ts`, `scan.ts`, `usePull.ts`, `useScanHandler.ts`, `images.ts`
- `src/app/(tabs)/pull/_layout.tsx`, `index.tsx`, `box/[boxId].tsx`, `missing/[lineKey].tsx`
- `src/app/pull-image.tsx`
- `src/components/pull/`
  - `PullChrome.tsx`: the mode strip and the scanner/status card
  - `PullImage.tsx`
  - `lineActions.ts`: the confirmations and the undo menu
- `assets/sounds/pull.wav`

**Changed (small, shared)**
- `src/app/(tabs)/_layout.tsx`: 5th tab after Pack, badge = lines still to pull.
- `src/app/_layout.tsx`: `startPullStore()`, `/pull-image` route.
- `src/lib/theme.ts`: `purple` colour and tint.
- `src/components/ui.tsx`: a `purple` tone for `Pill` and `Button`.
- `src/components/pick/ScanBanner.tsx`, `src/lib/pick/useScanHandler.ts`: an `info` banner tone, used for
  "sending…".
- `src/lib/pick/feedback.ts`: `feedbackPulled()`.
- `src/lib/pick/boxLabel.ts`: `boxScanIndex` takes any line with box fields. A type change only, so Pick's
  behaviour is the same.

**Reused from Pick**
- Box-label and column rules: `boxLabel`, `sameBoxLabel`, `boxScanIndex`, `boxColumn`, `compareBoxIds`.
  These are imported, not copied, so Pull groups boxes exactly as Pick does.
- `SKU_PATTERN`, `createImageCache`, `ScanCapture`, `ScanBanner`, `ui.tsx`, `call()`.
- **Nothing that holds picking state is shared:** no store, no events and no line types.

## 7. Status of our feedback, and what is left to confirm

**Revision 4 adopted all of our revision 3 feedback:**
- undo of a mistaken `missing` or `finish`
- undo on a completed line
- the owner's open-order rule: a SKU on an open order is never on the Pull list
- fixed reject codes
- the updated line in each event reply
- `POST /pull-event`
- the badge counts lines
- no pull sessions
- a missing item found later is relisted

The app design above matches revision 4.

**Left to confirm with the server team:**

A. **The phone needs to know when the order sync is broken, so it can turn Pull off.**
   - **The server already knows.** Each order sync it runs (`fp_ops/resync.py`, the same run behind
     `GET /pick-list?resync=1`) ends as `ok`, `failed` or `timeout`.
   - **For Pull, `timeout` must count as not synced.** Pick serves the current data on a timeout while the
     sync keeps running in the background. Pull must not.
   - **The result isn't kept anywhere yet.** The server only holds it for the request in progress.
   - **Ask:**
     1. Record the latest order sync result and time, whether the run came from Pick or from Pull.
     2. Add it to `GET /health`, which the app already checks every 30 seconds, as
        `"orders_sync": { "ok": true, "at": "…" }`.
     3. Also return `orders_not_synced` on `pull`, `finish` and `missing` while the latest sync failed. This
        is the safety net.
   - **App:** Pull is off whenever any of these happened:
     - the list load returned `orders_not_synced`
     - `/health` says the latest sync failed
     - an event came back `orders_not_synced`

     It shows the "Orders couldn't be synced" card (§3.1) until a reload syncs again.
   - **We dropped the age limit we proposed before** (for example 30 minutes). The orders that matter are
     placed before the end, and the sync before the list catches them. Ended listings can't take new sales,
     so a list doesn't become riskier while it's being worked. What matters is the latest sync failing.

B. **Bundle members: settled, no question left.** Pick already treats each member as a normal SKU
   (`fp_ops/picklist.py`, `_bundle_components`), and Pull uses the same rule:
   - **Membership** comes from `bundle_listings` (`bundle_sku` → `item_sku`, in `position` order).
   - **Title** is the member's own `bundle_listings.item_title`.
   - **Box and room** are the member's own `inventory_locations` row.
   - **Photos** are the member SKU's own, served by the Mac (`/images/<sku>/thumb.jpg|full.jpg`, the
     `ImageStore` lookup by the physical SKU). They don't come from eBay's CDN, and they aren't the
     bundle's.
   - **One difference from Pick:** a Pick line's SKU is `BUNDLE:MEMBER`. A Pull line's SKU is the plain
     member SKU, because there is one line per SKU and duplicates must merge. The bundle only appears on
     the line's actions (`bundle_sku` in §4), so the card can say "BUD-0101 member".

C. **Request shape** (§4): `{ device, event }` in, `{ event_id, accepted, reason, line }` out. Please
   confirm, or send the server's shape.

Only naming is still open in the requirements (§11).

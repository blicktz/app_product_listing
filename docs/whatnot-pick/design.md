# Whatnot show pick: UI design

Status: 2026-11-18, design draft for review. Nothing is built yet.

Related:
- Server side and the whole show-plan flow: `ebay_seller_port/whatnot_automation/docs/whatnot-show-plans.md` (Phase 4 is the server, Phase 5 this app).
- How it is built: [implementation-plan.md](implementation-plan.md).
- Order Pick, which this mirrors: `../order-picking-app/requirements.md`.
- Moving items back after the show: `../stow-app/move-back.md`.

## 1. What the Whatnot pick is for

Before a show, every auction item in the show plan has to come out of its storage box and into one staging box, **ST-PRE-WHT-001**. This is an ordinary printed storage box (room PRE). Its id is a Mac setting, `WHATNOT_PREP_BOX`, sent to the phone as `prep_box`. There it is laid out in lineup order (`#01`, `#02`, …), so that during the show you take the next item, show it, and press Run Next.

The mechanics are the same as order Pick: a list of lines grouped by box, a Bluetooth scanner, Mark picked / Undo / Can't find, and an offline event queue. What differs:

| | Order pick | Whatnot pick |
|---|---|---|
| What the list is | Orders waiting to ship | One show plan's auction lineup |
| Where an item goes | Out of stock (packed and shipped) | Moved to the location **ST-PRE-WHT-001** |
| Identity of a line | order + SKU | show plan + SKU, shown as its lot `#NN` |
| Getting the list | The Mac may first re-sync eBay and Shopify (up to 2 min) | The plan already lives in the Mac DB, so loading is instant |
| How many lists | One | One per show; you choose which |
| Afterwards | Pack | Lay out in lot order; after the show, Stow moves unsold items back |

## 2. Where the switch lives

### Options considered

1. **A sixth tab, "Whatnot".** The tab bar already has five tabs (Shoot, Stow, Pick, Pack, Pull). iOS shows at most five; a sixth goes behind "More", which is the worst place for a daily tool. **No.**
2. **A menu on the navigation title** ("Pick ▾", the iOS 16+ title-menu pattern). It looks clean, but the mode becomes hidden state: a one-letter difference in the title is easy to miss while scanning with a gun in hand. **No.**
3. **A setting in Server settings.** Far too hidden for something switched daily. **No.**
4. **A segmented control at the top of Pick home: `Orders | Whatnot`.** The Apple HIG uses a segmented control for switching between closely related views of the same kind of content, and that is what these two lists are. The current mode is always visible, it takes one tap, and every iPhone user knows it. **Chosen.**

### Rules that make it safe

- **Colour.** Every Whatnot screen uses Whatnot yellow, so a glance tells you the mode, the way the purple strip marks Pull today:
  - a yellow `WHATNOT · SHOW PICK` strip on every pushed screen (box, item, can't find)
  - a yellow scanner card
  - Order pick stays blue.
- **Counts in the segments.** `Orders 12 | Whatnot 4/20` shows what is waiting in each mode without switching.
- **Scope.** The switch exists only on Pick home. Pushed screens belong to one mode; the route itself is different (`/pick/box/…` versus `/pick/whatnot/box/…`). Going back returns you to the mode you came from.
- **Memory.** The last mode is remembered (in `Documents/pick/settings.json`), so the app reopens where you left off.
- **Scans go to the visible mode only.** If a scanned item belongs to the *other* mode's list (both lists are cached), the banner says so and offers the switch. It never records a pick in the hidden mode (§4.5).
- **Separate queues.** Switching modes never blocks: each mode has its own on-disk queue and keeps sending in the background.

## 3. Screens

### 3.1 Pick home, Orders mode (today's screen plus the switch)

```
┌─────────────────────────────────────┐
│                         🖥•   ⟳      │  header: server status, refresh
│ Pick                                │  large title (unchanged)
│ ┌─────────────────┬─────────────────┐│
│ │▓▓▓ Orders  12 ▓▓▓│   Whatnot 4/20  ││  segmented control (new)
│ └─────────────────┴─────────────────┘│
│ ┌───────────────────────────────────┐│
│ │ 12  to pick          3 of 15 picked││  summary card (unchanged)
│ │ ███████░░░░░░░░░░░░░░░░░░░░░░░░░░ ││
│ │ 9 orders · 6 boxes                 ││
│ │ Synced 14:05 · ✓ All picks sent    ││
│ └───────────────────────────────────┘│
│ ┌───────────────────────────────────┐│
│ │ ⌁  Scanner ready                   ││  BLUE scanner card
│ │    Scan a box label to start       ││
│ └───────────────────────────────────┘│
│ COLUMN AAC · 3 BOXES                 │
│ ┌───────────────────────────────────┐│
│ │ ○  ST-GAR-AAC-007     2 items  0/2 ›││
│ │ ◐  ST-GAR-AAC-008     3 items  1/3 ›││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

Nothing changes below the switch. Its refresh sheet keeps **Full sync (eBay + Shopify)** and **Quick reload**.

### 3.2 Pick home, Whatnot mode: "By box" (pulling items out of storage)

```
┌─────────────────────────────────────┐
│                         🖥•   ⟳      │
│ Pick                                │
│ ┌─────────────────┬─────────────────┐│
│ │   Orders  12    │▓▓ Whatnot 4/20 ▓▓││  selected segment tinted yellow
│ └─────────────────┴─────────────────┘│
│ ┌───────────────────────────────────┐│
│ │ 🎥 Fri Diecast Night            ⌄  ││  show card: tap to choose a show
│ │    Fri Nov 21 · 6:00 PM · scheduled││
│ │ 16  to pick          4 of 20 picked││
│ │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░ ││
│ │ #01–#20 · 5 boxes · 1 sold         ││
│ │ Loaded 14:07 · ✓ All picks sent    ││
│ └───────────────────────────────────┘│
│ ┌───────────────────────────────────┐│
│ │ ⌁  Scanner ready  → ST-PRE-WHT-001   ││  YELLOW scanner card
│ │    Scan a box label to start       ││
│ └───────────────────────────────────┘│
│ ┌──────────────┬────────────────────┐│
│ │▓▓▓ By box ▓▓▓│      Lineup        ││  second, smaller switch
│ └──────────────┴────────────────────┘│
│ COLUMN AAC · 3 BOXES                 │
│ ┌───────────────────────────────────┐│
│ │ ○  ST-GAR-AAC-007  #03 #11 #14 0/3›││  the box row lists the lot numbers in it
│ │ ✓  ST-GAR-AAC-008  #01 #02     2/2›││
│ │ ◐  ST-GAR-AAC-010  #04 #05 #19 1/3›││
│ └───────────────────────────────────┘│
│ UNLOCATED · 1 ITEM                   │
│ ┌───────────────────────────────────┐│
│ │ [img] #16 AAQ-0913-040           ›││
│ └───────────────────────────────────┘│
│ ALREADY IN ST-PRE-WHT-001 · 2          │  e.g. unsold items from the last show
│ ┌───────────────────────────────────┐│
│ │ [img] #07 AAQ-0909-017      ✓      ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

### 3.3 Pick home, Whatnot mode: "Lineup" (laying out the prep tray)

```
│ ┌──────────────┬────────────────────┐│
│ │    By box    │▓▓▓▓▓ Lineup ▓▓▓▓▓▓▓││
│ └──────────────┴────────────────────┘│
│ AUCTION LINEUP · 20                  │
│ ┌───────────────────────────────────┐│
│ │ #01 [img] Lotus Esprit 2002     ✓  ││  ✓ in ST-PRE-WHT-001
│ │     AAQ-0908-202 · AAC-007         ││
│ │ #02 [img] '64 Chevelle SS       ✓  ││
│ │     AAQ-0909-017 · AAC-008         ││
│ │ #03 [img] '68 Barracuda         ○  ││  ○ still in its box (box shown)
│ │     AAQ-0908-144 · AAC-007         ││
│ │ #04 [img] Honda CRX             ⚠  ││  ⚠ marked can't find
│ │ #05 [img] ̶T̶o̶y̶o̶t̶a̶ ̶A̶E̶8̶6̶   SOLD    ││  sold elsewhere: grey, struck through
│ │ …                                  ││
│ └───────────────────────────────────┘│
│ Lay items out in this order. Tap one │
│ to see it large.                     │
```

- The lot number is the first thing on each row, in large tabular digits.
- Tapping a row opens the item screen (3.6).
- Box rows and lineup rows use the same status icons as order Pick.

### 3.4 Show chooser (a sheet, from the show card)

```
┌─────────────────────────────────────┐
│ Choose a show                 Done  │
├─────────────────────────────────────┤
│ UPCOMING                            │
│ ┌───────────────────────────────────┐│
│ │ ● Fri Diecast Night               ││  ● = currently open
│ │   Fri Nov 21 · 6:00 PM · 20 items ││
│ │   4 picked                        ││
│ │ ○ Sunday Mixed Lots               ││
│ │   Sun Nov 23 · 2:00 PM · 35 items ││
│ │   0 picked                        ││
│ └───────────────────────────────────┘│
│ Only published shows appear here.   │
│ Plans are made in the ops console   │
│ (Whatnot tab).                      │
└─────────────────────────────────────┘
```

- The list holds published plans that aren't done, soonest first. Drafts never appear: the pick list exists only after "Create show" in the console.
- With exactly one upcoming show, it opens automatically and the card's ⌄ is hidden.

### 3.5 Box screen, Whatnot mode

```
┌─────────────────────────────────────┐
│ ‹                ST-GAR-AAC-007      │
│ ▓▓▓▓▓▓▓ WHATNOT · SHOW PICK ▓▓▓▓▓▓▓▓│  yellow strip (like Pull's purple)
│ Fri Diecast Night · 0 of 3 picked    │
│ ┌───────────────────────────────────┐│
│ │ ┌────┐ #03                        ││
│ │ │img │ AAQ-0908-144               ││
│ │ └────┘ Hot Wheels '68 Barracuda…  ││
│ │                    [ Mark picked ]││
│ ├───────────────────────────────────┤│
│ │ ┌────┐ #11  …                     ││
│ └───────────────────────────────────┘│
│ ┌───────────────────────────────────┐│
│ │ ⌁ Scan an item in this box         ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

The same "Can't find" route as order Pick is reached from a line's ⋯ menu.

### 3.6 Item screen (from Lineup or Unlocated)

```
┌─────────────────────────────────────┐
│ ‹                                   │
│ ▓▓▓▓▓▓▓ WHATNOT · SHOW PICK ▓▓▓▓▓▓▓▓│
│               #03                   │  huge lot number
│ ┌───────────────────────────────────┐│
│ │            [ large photo ]        ││
│ └───────────────────────────────────┘│
│ AAQ-0908-144                        │
│ Hot Wheels 1:64 1968 Plymouth…      │
│ In box ST-GAR-AAC-007 (GAR)         │
│ [ Mark picked ]   [ Can't find ]    │
└─────────────────────────────────────┘
```

### 3.7 Scan feedback

**A pick, in Whatnot mode:**
```
┌───────────────────────────────────┐
│  ✓  #07  → ST-PRE-WHT-001           │  green, large; the number is the hero
│     AAQ-0909-017 · put it 7th     │
└───────────────────────────────────┘
```

**Wrong mode:** in Orders mode you scan an item that is on the open Whatnot show.
```
┌───────────────────────────────────┐
│  ⚠  AAQ-0909-017 is #07 on        │  orange; nothing is recorded
│     "Fri Diecast Night"           │
│     [ Switch to Whatnot ]         │
└───────────────────────────────────┘
```

Other banners are reused from order Pick: already picked, not on this list, in a different box.

### 3.8 Header refresh menu, per mode

| Orders mode | Whatnot mode |
|---|---|
| Full sync (eBay + Shopify) | Reload this show |
| Quick reload | Choose show… |
| Cancel | Cancel |

Pull-to-refresh does a quick reload of whichever mode is showing.

### 3.9 Empty and offline states, Whatnot mode

```
  No Whatnot show to pick               Can't reach the Mac
  Publish a show plan in the ops        Showing "Fri Diecast Night" as
  console's Whatnot tab first.          loaded at 14:07. Picks are saved
  [ Reload ]                            and sent when the Mac is back.
                                        [ Try again ]  [ Server settings ]
```

## 4. Getting the list from the Mac

### 4.1 What is different from orders

- **No re-sync step.** The order list may need a 2-minute eBay/Shopify re-sync first, because orders arrive on the marketplaces. A show plan is written straight into the Mac DB by the ops console, so loading it is a plain read that takes under a second. Whatnot mode therefore **loads automatically**, with no "Full sync" option:
  - on entering the mode
  - on choosing a show
  - when the app comes back to the foreground
  - on pull-to-refresh
- **Two lists, not one.** A small **show index** (which shows exist) and the **lineup** of the chosen show.
- **The truth of "picked" is the location table.** A line is picked when its SKU is in ST-PRE-WHT-001 on the Mac, not merely because a pick event exists. So an item that is already in ST-PRE-WHT-001 is picked:
  - an unsold item from the last show
  - an item moved there by Stow

  An item moved back out by Stow is open again.

### 4.2 Endpoints (built in fp_ops, Phase 4)

All endpoints use the same bearer token and base URL as Pick, through `call<T>()`.

`GET /whatnot-shows` returns the show index:
```json
{ "generated_at": "2026-11-21T22:07:00Z", "prep_box": "ST-PRE-WHT-001",
  "shows": [ { "plan_id": 7, "title": "Fri Diecast Night", "scheduled_at": "2026-11-21T18:00",
               "whatnot_status": "scheduled", "n_items": 20, "n_picked": 4, "n_sold": 1,
               "plan_version": "b41c…" } ] }
```

`GET /whatnot-pick?plan_id=7` returns one lineup:
```json
{ "plan_id": 7, "title": "Fri Diecast Night", "scheduled_at": "2026-11-21T18:00", "number_width": 2,
  "prep_box": "ST-PRE-WHT-001",
  "plan_version": "b41c…", "generated_at": "…",
  "lines": [ { "line_key": "wn:7:AAQ-0908-144", "lot": 3, "sku": "AAQ-0908-144", "title": "…",
               "image_url": "…", "image_url_full": "…", "room": "GAR", "box_id": "ST-GAR-AAC-007",
               "status": "open|picked|missing|sold", "in_prep": false, "previous_box": null } ],
  "removed_in_prep": [ { "sku": "…", "title": "…", "previous_box": "ST-GAR-AAC-004" } ] }
```

`POST /whatnot-pick-events` takes `{device, events:[{event_id, plan_id, sku, line_key, action: pick|undo|missing|reject, method: scan|manual, box_id, scanned_value, note, at}]}` and returns `{accepted:[event_id…], plan_versions:{"7":"b41c…"}}`.

### 4.3 Keeping the list current: `plan_version`

The console can change a lineup after the phone has loaded it: add, remove, reorder, renumber. To handle this:
- **The version.** The Mac computes `plan_version`, a hash of the plan's items, positions and prices, and returns it with the list *and* with every event POST.
- **What the phone does with it.** The phone compares the returned version with the one it holds:
  - no unsent events: it reloads quietly
  - unsent events: it shows a yellow bar, "Lineup changed on the Mac · Reload", which flushes first and then reloads
- **Why it's safe.** Picks are keyed by **plan + SKU**, never by lot number. Renumbering can't misapply a pick; only the displayed `#NN` changes. So the **Lineup** view must be up to date before you lay out the tray. Show a "loaded 14:07" time on it, and the bar if it's stale.

### 4.4 Offline, cache and queue

- **Files** under `Documents/whatnot-pick/`:
  - `settings.json`: last plan_id
  - `shows.json`: the cached index
  - `plans/<plan_id>.json`: the cached lineup, with `fetchStartedAt`
  - `events.json`: the queue for every plan
- **Send and retry.** Same rules as Pick:
  - write the event to disk first, then send after 500 ms
  - retry every 30 s and on returning to the foreground
  - flush before every reload
  - `derive` applies only the events the Mac hasn't counted yet (by `fetchStartedAt`)
- **Offline picking is allowed**, unlike Pull: a pick is a reversible move, not a disposal.
- **Photos** are cached like Pick's, for the open plan's lines only. Cleanup keeps photos for lines of any cached plan.

### 4.5 Spotting a scan meant for the other mode

- Both modes' cached lists are in memory, so the scan handler checks a scan that isn't on the visible list against the other list. It never records the scan there; it only offers the switch (3.7).
- When the other list is stale or not loaded, it simply says "not on this list".

### 4.6 Items removed from the show after they were picked

- If the console removes an item that is already in ST-PRE-WHT-001, the Mac lists it under `removed_in_prep`.
- The phone shows a section, **"Picked, no longer in this show · put back"**, with the previous box and a **Put back** button.
- **Put back** sends an `undo` event, and the Mac moves the SKU back to `previous_box`, as Stow's move-back does.

## 5. Out of scope here
- the sold pile and packing in sale order (a later phase)
- moving unsold items back after the show (Stow already does this through `previous_box`)
- creating or editing show plans on the phone (the ops console does that)

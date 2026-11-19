# Whatnot show pick: phone app implementation plan

Status: 2026-11-18. **Built** (see Progress at the end); waiting for the acceptance run on the phone. The UI and data flow are in [design.md](design.md).

**Depends on** the server endpoints from fp_ops Phase 4 (`ebay_seller_port/whatnot_automation/docs/whatnot-show-plans.md`):
- `GET /whatnot-shows`
- `GET /whatnot-pick`
- `POST /whatnot-pick-events`
- the prep box `ST-PRE-WHT-001` (fp_ops setting `WHATNOT_PREP_BOX`)

Build and test the server first. Then build the app against Test Show 111.

## Principles
- **Order Pick doesn't change.** Its screens, store and event file stay as they are. The only change to Orders mode is the segmented control on Pick home.
- **Reuse, don't fork.** The Whatnot pick reuses everything mode-agnostic: `call<T>()`, `ScanCapture`, `PickImage`, the feedback sounds, box grouping, and the scan-classify helpers. It gets its own small store, because its list, cache files and refresh rules differ (design §4).
- **One mode per screen.** Pushed Whatnot screens live under `pick/whatnot/…` and always show the yellow strip.

## Steps

### 1. Theme and shared pieces
- **Theme:** add `yellow: PlatformColor('systemYellow')` to `src/lib/theme.ts` `colors`, and `yellow: 'rgba(255,204,0,0.20)'` to `tints`.
- **`src/components/whatnot-pick/WhatnotStrip.tsx`:** the "WHATNOT · SHOW PICK" strip (yellow, dark text), modelled on Pull's `ModeStrip`.
- **`src/components/pick/ModeSwitch.tsx`:** the `Orders N | Whatnot n/m` segmented control.
  - Use the `@expo/ui` SwiftUI `Picker` with the segmented style. `@expo/ui` is already a dependency, and this gives the native look.
  - **Fallback:** if that Picker doesn't size well inside the scroll header, use a hand-built two-button control in the style of the radio row in `pick-settings.tsx`.
- **Pick mode setting:** add `pickMode: 'orders' | 'whatnot'` to `Documents/pick/settings.json`, through the existing settings read/write in `src/lib/pick/api.ts` / `store.ts`, with a `usePickMode()` hook.

### 2. Data layer: `src/lib/whatnot-pick/`
- **`types.ts`:** `ShowSummary`, `WhatnotLine` (line_key, lot, sku, title, image urls, room, box_id, status, in_prep, previous_box), `WhatnotPlan`, `RemovedInPrep`, and `WhatnotEvent`.
- **`api.ts`:** `fetchShows()`, `fetchPlan(planId)` (20 s timeout) and `sendEvents(events)`, all through `call<T>()` from `src/lib/pick/api.ts`.
- **`store.ts`:** a module store using the same `useSyncExternalStore` pattern as `src/lib/pick/store.ts`.
  - **Cache files:** `Documents/whatnot-pick/{settings,shows}.json`, `plans/<id>.json`, `events.json`.
  - **Queue functions:** `recordEvent`, `scheduleSend`, `flushEvents`. These are copies of Pick's queue logic, kept small. If the duplication grows, they can be moved into a shared `src/lib/eventQueue.ts` later.
  - **`refreshShows()` and `refreshPlan(planId)`:** each flushes first, then fetches, sets `fetchStartedAt`, and caches the result.
  - **`selectShow(planId)`.**
  - **Auto-load:**
    - on mode enter
    - on show change
    - on `AppState` → active while in Whatnot mode
  - **`plan_version`:** comes back on every list fetch and events POST.
    - The list matches: nothing to do.
    - Unsent events are waiting: set `stale = true`, which shows the "Lineup changed on the Mac" bar.
    - Nothing is waiting: reload quietly.
- **`derive.ts`:** `deriveLineStates`, which applies unsent and uncounted events on top of the server status. It also maps lines to the shape `groupColumns` / `compareBoxIds` expect, so By-box reuses `src/lib/pick/derive.ts` unchanged (qty is always 1).
- **`images.ts`:** reuse `src/lib/pick/images.ts`, pointed at the open plan's lines. Cleanup must keep the files that order Pick still uses.
- **`useWhatnotScan.ts`:**
  - **Same rules as Pick's handler:** box label → open that box; SKU on the list and open → pick; and the same banners.
  - **New success banner:** "#07 → ST-PRE-WHT-001".
  - **Cross-mode check:** export a small `findInOrders(sku)` from the Pick store, and a matching `findInShow(sku)` from this store. A miss on the visible list is checked against the other mode, which gives the "Switch to …" banner. The other mode is never written to.

### 3. Screens
- **`pick/index.tsx`** becomes a shell: `<ModeSwitch/>`, then `<OrdersHome/>` or `<WhatnotHome/>`.
  - Move today's body into `src/components/pick/OrdersHome.tsx`, unchanged.
  - `HeaderButtons` picks its action sheet by mode (design §3.8).
- **`src/components/whatnot-pick/WhatnotHome.tsx`:**
  - the show card, with progress and the sync line
  - the yellow scanner card
  - a By box / Lineup switch
  - columns of box rows, with the lot numbers listed on each row
  - sections: Unlocated, Already in ST-PRE-WHT-001, and "Picked, no longer in this show · put back"
  - empty and offline states (design §3.9)
- **New routes**, added to `pick/_layout.tsx`:
  - `pick/whatnot/box/[boxId].tsx`: lines with large `#NN`, Mark picked / Undo, and the strip
  - `pick/whatnot/item/[sku].tsx`: large lot number and photo, box, Mark picked / Undo / Can't find
  - `pick/whatnot/missing/[sku].tsx`: records `missing`, clears it with `undo`, and shows where items from the same batch are, as Pick does
  - `pick/whatnot/shows.tsx`: the show chooser, presented as a sheet (`presentation: 'formSheet'`)

### 4. The prep box: nothing to change in Stow
- **An ordinary box.** The prep location is the printed storage box **`ST-PRE-WHT-001`** (room PRE). It matches the `ST-<room>-<col>-<nnn>` rule in `boxLabel.ts`, so Stow opens it and moves items in and out of it with no special case.
- **Label.** Print its label with the Mac's Storage labels task: room PRE, box code WHT, start 1, count 1.
- **The box id is never hard-coded in the app.** The Mac sets it (`WHATNOT_PREP_BOX`, default `ST-PRE-WHT-001`) and sends it as `prep_box` in `/whatnot-shows` and `/whatnot-pick`. Banners and section titles use that value.

### 5. Docs
- **`docs/whatnot-pick/requirements.md`:** the acceptance list below, in the style of the other app docs.
- **`docs/order-picking-app/requirements.md`:** a short note on the mode switch.

## Acceptance (manual, on the phone, against Test Show 111)
1. **Startup.** Pick opens in the last mode used. Orders mode looks and works as before, with the switch added.
2. **Opening the show.** Whatnot mode loads the show index on entry. With one published show, it opens that show. The card shows its title, time and `#01–#04`.
3. **By box.** The view groups the 4 items by box, with lot numbers on each box row. Lineup lists `#01..#04` in order.
4. **Picking by scan.** Scan a box, then an item:
   - the banner shows "#0N → ST-PRE-WHT-001"
   - the line is ticked
   - on the Mac, `inventory_locations` shows `ST-PRE-WHT-001` with the old box as `previous_box`
5. **Undo.** Undo moves the item back to its box on the Mac.
6. **Offline.** With Wi-Fi off, pick 2 items. The card shows "2 picks not sent". With Wi-Fi back on, both are sent and the Mac agrees.
7. **Lineup changed on the Mac.** Reorder the show in the ops console:
   - while the phone has unsent picks: it shows the "Lineup changed" bar, and Reload shows the new numbers
   - with nothing unsent: it reloads quietly when the app comes back to the front
8. **Removed after picking.** Remove a picked item from the plan in the console. It appears under "no longer in this show", and **Put back** moves it to its old box.
9. **Wrong mode.** Scan a show item in Orders mode. The "is #0N on …" banner appears with Switch, and nothing is recorded.
10. **Sold items.** An item sold on eBay shows grey and struck through in Lineup, and can't be picked.
11. **Stow move-back.** Stow can open `ST-PRE-WHT-001`, and scanning an item into its old box moves it back (move-back).

## Checks
- The repo has no test runner, so the checks are `npm run lint` plus the acceptance list above.
- Build and install with `make` (Release, devicectl) to your iPhone.
- Optional: add a small Jest set for `whatnot-pick/derive.ts` and the scan classifier, if a runner is wanted.

## Order of work
1. Server (fp_ops Phase 4) first, checked with curl against Test Show 111.
2. App steps 1–2 (theme, switch, data layer), then step 3 (screens), then step 4 (Stow), then step 5 (docs).
3. Acceptance run on the phone, then commit in both repos.

## Progress (2026-11-18): built
**New code**
- `src/lib/whatnot-pick/`:
  - `types.ts`, `api.ts`
  - `store.ts`: cache, queue, auto-load, `plan_version` handling, `findInShow`, `toPickLine`
  - `useWhatnot.ts`: `useWhatnotData`, and `useWhatnotScan` with the "#07 → ST-PRE-WHT-001" and "is on an order" banners
- `src/components/pick/ModeSwitch.tsx`.
- `src/components/whatnot-pick/WhatnotStrip.tsx` and `WhatnotHome.tsx`.
- Routes `pick/whatnot/box/[boxId]`, `pick/whatnot/item/[sku]` and `pick/whatnot/shows` (a form sheet).

**Changes to existing code**
- `pick/index.tsx` is now a shell: `OrdersHome` (unchanged, plus the switch) or `WhatnotHome`.
- `pick/store.ts`: a remembered `pickMode` (in `settings.json`), `setPickMode` and `findInOrders`.
- `useScanHandler.ts`: shows the "is #NN on <show>" banner for a show item scanned in Orders mode.
- `PickImage`: takes an optional `uri` and `onPress`.
- `theme.ts`: `yellow` and `onYellow`.
- `_layout.tsx`: calls `startWhatnotStore()`.

**Differences from the plan**
- **No Can't-find route.** Can't find is a note prompt on the box and item screens instead of its own route (`pick/whatnot/missing`). The Whatnot list has no batch neighbours to suggest, so a separate screen added nothing.
- **Hand-built switch.** The switch is built from plain views, not the `@expo/ui` Picker, so it can carry the yellow selected state and the counts.
- **Stow needs no change.** The prep box `ST-PRE-WHT-001` is an ordinary printed label.

**Checks**
- `npx tsc --noEmit` is clean, and so is `npx expo lint`.
- `npx expo export --platform ios` bundles.
- **Not done yet:** installing it and the acceptance run on the phone. Two paired iPhones were listed, so run `make` and choose the pick phone.

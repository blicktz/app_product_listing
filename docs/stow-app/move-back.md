# Stow: remembering the previous box (move and move back)

Status: 2026-11-12, written by the app side. Read with `requirements.md` in this folder. This doc only covers what changes. Everything else in Stow stays as it is.

## Why
For Whatnot shows, the planned items are moved from their storage boxes into one Whatnot box. After the show, the unsold items go back to the boxes they came from. Stow can already move an item: open the new box and scan the item. What it can't do is say where the item was before. Once an item is in the Whatnot box, nobody knows where it goes back.

So the server must **remember each SKU's previous box**, which is the box it was in before its most recent move, and send it to the phone.

Decisions already made:
- There are no special staging boxes. The Whatnot box is an ordinary storage box with a printed `ST-…` label. "Previous box" is just the box the SKU was in before its last move.
- The SKU's whole record moves. Stow never splits a SKU across boxes. Since 2026-11-16 the count restarts at 1 in the new box and each remaining unit is scanned (see `requirements.md`).
- Picking Whatnot orders is a separate workflow. Pick is unchanged.

## What the phone does with it (for context)
- **Lookup.** On the Stow home screen, with no box open, scanning a SKU that's recorded in a box shows "SKU is in BOX", its units, and its previous box. Nothing is recorded, because it's only a lookup. A SKU recorded nowhere is still rejected with "Scan a box first", as before.
- **Moves happen without asking.** With a box open, scanning a SKU recorded in another box moves it straight away, with its count restarting at 1; the remaining units are then scanned one by one. There's no "Move them all here?" prompt any more. A mistaken move is undone with `↶` on its row. The banner is green "moved back here" when the open box is the SKU's previous box, and orange "moved here" otherwise.
- So the phone **no longer sends `move_declined`**. Every other event is unchanged. A move back is an ordinary move (`stow` with `moved_from_box`).

## Server changes

### 1. Keep a previous box per SKU
Add a nullable `previous_box` (printed label) to the location table's row for each SKU. Keep its old value on each ledger row that changes it, so an undo can put it back.

| What happens to the SKU | `previous_box` becomes |
|---|---|
| Confirmed move (`stow` with `moved_from_box`) | The box the row was in **before** the event, as the server had it. Normally that's the same as `moved_from_box`. |
| Stale-phone move (a `stow` into another box without `moved_from_box`, which raises `stow_conflict`) | The box the row was in before the event |
| Fix from a location issue that changes the SKU's box | The box it was in before the fix |
| `undo` of a move (the SKU returns to `moved_from_box`) | Its value from **before** that move |
| Plain `stow` into the box it's already in, `adjust`, stow `undo` of a non-move, `pick`, pick `undo` | Unchanged |
| Row created by a first stow, or by the seed import | `null` |
| Row deleted (count reaches 0) | Gone with the row. If the SKU is stowed again later, it starts as `null`. |

Notes:
- A move back is just another move. After moving A → Whatnot → A, `previous_box` is the Whatnot box. That's expected.
- A move that doesn't change the box (`moved_from_box` equal to the box the row is already in) leaves `previous_box` unchanged.
- An old ID and its printed label are the same box (`requirements.md`, "Box identity"). Store and compare printed labels.

### 2. `GET /stow-state`: add `previous_box`
```json
{
  "locations": [
    { "sku": "AAU-1109-012", "box_label": "ST-GAR-WNT-001", "units": 1, "previous_box": "ST-GAR-AAC-004" }
  ]
}
```
- `previous_box`: printed label, or `null` when there isn't one.
- The field is additive. A phone that doesn't know it ignores it, and the current phone treats a missing field as `null`. The server and the phone can be updated in either order.

### 3. `GET /stow-audit?sku=…`: include it
Show the SKU's `previous_box` next to its current box and units. This is only for completeness, since the event history already lists every move.

### 4. Backfill (one time)
For SKUs already in the table, set `previous_box` from the ledger: the box before the SKU's most recent move that hasn't been undone. Otherwise leave it `null`. If that's hard to do, `null` for everything is acceptable. Only items moved before the change would lose their previous box.

## Acceptance
1. Stow SKU X into box A. `previous_box` is `null`.
2. Move X to box W. `box_label` = W, `previous_box` = A, and the units are 1 (each further scan in W adds 1).
3. Undo that move. `box_label` = A, `previous_box` = `null`, which was its value before the move, and the units are back to the count it had in A.
4. Move X to W again, then move it back to A. `box_label` = A, `previous_box` = W.
5. Stow one more unit of X into A, or adjust its count. `previous_box` stays W.
6. Pick X until its count reaches 0. The row is gone. Stow it again into B: `previous_box` = `null`.
7. A stale phone stows X into C without `moved_from_box` while X is in A. `box_label` = C, `previous_box` = A, and a `stow_conflict` issue is raised.
8. The integrity check (`?check=integrity`) still returns nothing. Replaying the ledger must also rebuild `previous_box`.

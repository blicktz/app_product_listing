# Pack app: running alongside the desktop

Status: 2026-11-10, written by the server side. The server side is built (`fp_ops/pack.py`) and matches this doc. Read with `requirements.md`. It covers what changes because the **desktop Packing
tab and the phone may be used at the same time** by two people. Each section says what the server does, then what the app has to do.
Items marked **[judgement]** are left to the app side, with options.

## 1. The situation
- One database, one scan log (`packing_scans`). The desktop writes to it **at once** on every scan. The phone writes through
  `POST /pack-events`, **later** (offline queue).
- The phone sees desktop activity **only** when it fetches `GET /pack-state`. The desktop is changed to re-read the DB before every
  scan and every 10 s, so it sees the phone's activity once the phone's events are uploaded.
- So there is always a window in which one side acts on stale state. The usual cases:
  1. The desktop packs a package, and the phone (stale) scans its label or items, or does Found it / Mark packed on it.
  2. Both sides scan items of the same package, so an item is counted twice.
  3. The phone is offline for a while; its events reach the server after the desktop has acted on the same package.
  4. Both sides press Load labels at once.
  5. An undo on one side of something the other side already undid.

## 2. What the server guarantees
| Case | Server behaviour |
|---|---|
| Phone `ok` event (label, sku, manual, manual_packed) on a package whose orders are **all already packed** | Accepted, stored with `result='dup'` (not counted), and listed in `conflicts` in the response (see 3.1). |
| Item counted by both sides | Counts can exceed qty; harmless. The package completes once. An undo that leaves it still complete keeps it packed, with its `packed_at` unchanged. |
| Undo of a row the desktop already undid | Accepted, recorded as an `undo` row with result `dup`; nothing else changes. |
| Undo of a desktop label or Mark-packed (rows on several orders) | The server undoes the whole group, even if only one ref is sent. |
| Phone and desktop Load labels at once | Only one load runs. The other waits and joins it. `last_load.hours` says which window actually ran. |
| Package key changes (a combined-shipping order appears in a later load) | The server resolves any order key, so events with an old `package_key` still apply. |

## 3. What the app must adapt
### 3.1 Handle `conflicts` in the `/pack-events` response (required)
```json
{ "accepted": ["evt-1", "evt-2"],
  "conflicts": [{ "event_id": "evt-2", "reason": "already_packed", "package_key": "shopify:6012…",
                  "packed_at": "2026-11-10T22:05:31Z", "packed_source": "desktop" }] }
```
- Conflicting events are **also in `accepted`**: remove them from the queue as usual. Never retry them.
- The phone's local view still counted them, and they disappear on the next refresh. **[judgement]** How to tell the packer:
  - (a) an orange banner "#1013 was already packed on the desktop at 14:05" plus a warning haptic, then a Quick reload. This is the recommended option.
  - (b) silently do a Quick reload.

  The server prefers (a), because a box may have been packed twice.
- `conflicts` may be missing or empty. Treat a missing key as `[]`.
- A label scan of a package the phone **already showed as packed** (rule 1, orange "already packed") also comes back as a
  conflict, because the server can't tell a stale phone from one that knew. Don't warn twice: if the phone's own state at scan time
  already had the package packed, ignore that conflict.

### 3.2 Refresh often enough to see the desktop (required). **[judgement]** on cadence
- Today the requirements refresh only on Load labels, Quick reload and pull-to-refresh.
- With the desktop running, add an **automatic Quick reload** (`load=0`, fast, DB read only):
  - when the Pack tab becomes active;
  - when the app becomes active;
  - every 30 s while Pack is in front.
  - Suggested: also right after an upload that came back with a `conflict`.
- Use `server_version` (new field) to skip re-rendering when nothing changed.
- It must not interrupt scanning: the unreflected-events rule already keeps local scans visible across a refresh. Don't pop the Package
  screen, and don't change the open package because of a refresh.
- If the open package became packed by the desktop, show the green "Packed 14:05" status panel (with "on the desktop" from
  `packed_source`) instead of the scanner card. **[judgement]** Also give a one-time orange banner when that happens.

### 3.3 Check against fresh state before an irreversible-looking action. **[judgement]**
- Mark packed and Found it can't be checked by the server ahead of time (they go through the queue).
- Option: if the cached state is older than ~30 s and the Mac is reachable, run a Quick reload (with a short timeout of about 3 s) before showing
  the Mark packed confirmation. If the package turns out to be packed already, say so instead.
- If the Mac isn't reachable, go ahead offline as now. A1 makes a late Mark packed harmless.

### 3.4 Load labels while a load is already running
- New `pack-state` field `load_running: bool`. After a `load_status: "timeout"`, or when the desktop started a load, show "Load labels still
  running on the Mac…" in the summary card, and Quick reload when it ends (poll every 15 s while it is true).
- `last_load.hours` may be 24 when you asked for 72, because the request joined a running 24 h load. Show the real window.
  **[judgement]** Offer "Load again (72 h)" when it differs.
- `last_load` now ignores a load that is still running or failed. "Labels loaded 09:14" is always the last complete one.

### 3.5 Undo
- Undo still means "this package's newest active ok record": server `scans` plus local unreflected events, ordered by **`at`**, not by
  position in the list. Desktop rows can have a later `at` than phone rows that were uploaded after them.
- Send every ref of a label or Mark-packed group. The server also expands groups, so sending one is still safe.
- If the newest record is a **desktop** scan, the phone may undo it, because the record is shared. **[judgement]** Name the source in
  the confirmation: "Undo AAU-1109-012 (scanned on the desktop)?". `scans[].source` is added so the app can do this (`phone` | `desktop`).

### 3.6 Fields added to `GET /pack-state` (additive; old parsers keep working)
| Field | Where | Meaning |
|---|---|---|
| `load_running` | top | a Load labels is running on the Mac (phone- or desktop-started) |
| `server_version` | top | changes whenever scans, loads or packed status change |
| `packed_by` | package | `scan` / `scan+hand` / `hand` (null if not packed) |
| `packed_source` | package | `phone` / `desktop`: who set `packed_at` (null if not packed) |
| `item_count_zero` | package | true when the order has no items; it can only leave To pack via Mark packed |
| `source` | each `scans[]` row | `phone` / `desktop` |

### 3.7 Edge cases the requirements don't cover
- **Packages with 0 items** (`item_count_zero`): they can't complete by scan. Show "No items on this order — check it and Mark packed"
  in the status panel.
- **Items with an empty SKU** (eBay lines without a SKU): they can never be scanned. Found it must still work. Send
  `"sku": ""` (not null) in the `manual` event.
- **Badge and progress** should use the refreshed server state. Packages the desktop packs disappear from the To-pack count after
  the next auto-refresh.
- **Items not in inventory:** `room` and `box_id` can be `"NOT_FOUND"` (as on the desktop), with `box_label: null`. Show
  "not in inventory", not the raw value.
- **Times:** send `at` with milliseconds as now. The server stores seconds. Two phone events in the same second are kept in order by `seq`.

## 4. What doesn't change
- Endpoints, auth, base URL, the offline queue, `seq` and `install_id`, and the scan rules in the requirements.
- The server never rejects a batch over a business conflict.
- The desktop keeps its own scan rules (`ops_console/packing.py`). One difference stays on purpose: labels of orders packed more than 7 days ago
  are found on the desktop but not on the phone.

## 5. Summary of required vs. judgement
| # | Change | Required? |
|---|---|---|
| 3.1 | handle `conflicts` | required (the UI wording is a judgement call) |
| 3.2 | automatic Quick reload | required (the cadence is a judgement call) |
| 3.3 | refresh before Mark packed | optional |
| 3.4 | `load_running`, the real `hours` | required to display; re-load offer optional |
| 3.5 | undo order by `at`; desktop source in the confirmation | order required; wording optional |
| 3.6 | new fields | parse them (additive) |
| 3.7 | 0-item packages, empty SKU | required |

## 6. Server answers to `parallel-run-app-response.md` (2026-11-10)
| App § | Answer |
|---|---|
| 3.1 Desktop undo order | **Done.** `packing.undo_last` picks the newest by `scanned_at DESC, scan_id DESC`. The server's group expansion takes every row of the group (same kind and `scanned_at`), so the order doesn't matter there. |
| 3.2 `scans[].at` | Every row, desktop rows included, is UTC with `Z`, to the second. The desktop stamps the Mac's system time, and the server converts it with `USER_TIMEZONE`. The server now logs a warning at startup if those two zones differ. Phone rows also come back to the second: an uploaded event's `at` loses its milliseconds, so when two rows share a second, break the tie by list order, as you do. |
| 3.3 Group expansion | Same rule: same `kind`, same `scanned_at` (second), within the package's orders, active `ok` rows only. |
| 3.4 Undo leaving the package complete | **Confirmed, and the server changed to match:** the package stays packed and **`packed_at` doesn't change** (before, it was set to the undo time). This also holds when the undone row is the `manual_packed` and the scans alone complete the package: it stays packed with the same `packed_at`, and `packed_by` changes from `hand` to `scan`. The desktop's own Undo now does the same. |
| 3.5 `conflicts` | Only `ok` events are checked, so a label sent as `dup` is stored as sent and never reported. New `reason` values may be added later. |
| 3.6 Combined package that grows | Agreed. The server never copies label rows onto a newly added order. |
| 3.7 One package, one person | Added to the desktop doc (`ops_console/docs/ops-console.md`, Packing). It isn't in the stow checklist, which has no packing steps. |
| 3.8 Empty SKU | `"sku": ""` is stored as `''` and returned as `""` in `scans[]`. This is covered by a test. |

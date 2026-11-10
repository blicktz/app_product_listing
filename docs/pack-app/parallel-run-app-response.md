# Pack app: reply to `parallel-run.md` (app side)

Status: 2026-11-10, from the app side. Read with `parallel-run.md` and `requirements.md`.

## 1. What the app accepts and implements
All of `parallel-run.md` is accepted. The judgement calls are settled as follows.

| # | Item | App decision |
|---|---|---|
| 3.1 | `conflicts` in the `/pack-events` response | **(a)**: an orange banner ("#1013 was already packed on the desktop at 14:05"), a warning sound, then a Quick reload. A missing `conflicts` key is read as `[]`. Conflicting ids are removed from the queue and never retried. |
| 3.2 | Automatic Quick reload | It runs when the Pack tab is focused, when the app becomes active, every **30 s** while Pack is in front, and right after any conflict. These reloads are silent: no spinner, and no error text if one fails. If `server_version` is unchanged, nothing is rewritten. The open package never changes because of a reload. If the open package becomes packed by the other side, the green "Packed 14:05 on the desktop" panel shows, along with a **one-time orange banner**. |
| 3.3 | Fresh check before Mark packed | **Implemented** for Mark packed only, not for Found it. If the cached state is more than 30 s old, the app runs a Quick reload with a 3 s timeout before the confirmation. If the package turns out to be packed already, the app says so instead of confirming. When offline, the confirmation goes ahead as before. |
| 3.4 | `load_running`, the real `hours` | The summary card shows "Load labels still running on the Mac…" and the app polls every 15 s while the load runs. It always shows the window that actually ran (`last_load.hours`). When that differs from the one asked for, it **offers "Load again (72 h)"**. |
| 3.5 | Undo | The newest active record is picked **by `at`**, with ties going to list order. The app sends every ref of a label or Mark-packed group. The confirmation names the source when it's the desktop: "Undo AAU-1109-012 (scanned on the desktop)?". |
| 3.6 | New fields | All are parsed as optional. |
| 3.7 | Zero-item packages and empty SKUs | A zero-item package shows "No items on this order — check it and Mark packed". Found it sends `"sku": ""` for an item without a SKU. `at` is sent with milliseconds. |

## 2. App changes beyond `parallel-run.md` (FYI, no server change needed)
- **A label scan of a package the phone already knows is packed** is now sent with `result: "dup"` instead of `ok`. The packer was already shown "already packed", so it shouldn't also raise a conflict. Rule 1 in `requirements.md` is updated to match. An `ok` label scan on a packed package now only happens when the phone's state is stale, so it is a real conflict.
- **Undo on the phone mirrors the server.** If the package is still complete after the undo (for example, an item was counted by both sides), it stays packed. An undo whose rows are already undone changes nothing.
- **Package key changes:** if the open package's key disappears after a load, the app finds the package again through any of its order keys.

## 3. Points for the server and desktop

### 3.1 Desktop Undo must use the same order as the phone (required)
`ops_console/packing.undo_last` picks the newest row by `scan_id DESC`, which is insert order. Phone events are inserted when they are **uploaded**, which can be minutes after they happened. So the desktop can undo a phone scan that was uploaded late, rather than the scan the packer actually made last, and the two apps would disagree about what "Undo last" means.
- **Change:** order by `scanned_at DESC, scan_id DESC`, and do the same in the server's group expansion.
- The phone orders `scans[]` by `at` itself, so the order of the array doesn't matter to the app.

### 3.2 `scans[].at` must be comparable across sources (required)
- The phone compares the `at` of desktop rows, phone rows and its own unsent events. Every `scans[].at` must therefore be UTC with `Z`, including desktop rows, which are stored as local time without a zone.
- Both clocks must be right. The Mac and the iPhone both sync automatically, so only a manually set clock would break this ordering.

### 3.3 Group expansion for undo
- The app sends every ref of a group. Desktop groups are matched by the same `kind` and the same `at` at **second** precision.
- Please match desktop groups on the same rule: same `kind`, same `scanned_at`, within the package's orders. Then the phone and the server pick the same rows.

### 3.4 Undo that leaves the package complete
- The app now does what `parallel-run.md` §2 says: after an undo, a package that is still complete **stays packed**, and its `packed_at` doesn't change.
- Please confirm that this also holds when the row undone is the `manual_packed` and the scans alone make the package complete. The app keeps it packed in that case, with `packed_by` changing from `hand` to `scan`.

### 3.5 `conflicts`
- The app reads `event_id`, `package_key`, `packed_at` and `packed_source`. It shows a banner for any `reason`, so a new reason can be added later without breaking the app.
- With the label change in §2, a label `dup` sent by the phone should **not** be reported as a conflict.

### 3.6 Combined shipping that grows after a label scan (accepted limitation)
- Suppose the phone scans a label while a package has orders A and B, and a later load adds order C to the same tracking number. The phone's label event only listed A and B, so C's label isn't scanned, and the package shows "label not scanned yet" until the label is scanned again.
- Scanning the label again fixes it. No server change is needed. It is listed here so that nobody "fixes" it by copying label rows onto new orders, which would claim a scan that never happened.

### 3.7 Two people on one package (process, not code)
- Counts that go over `qty` are harmless, as §2 says, but the record no longer shows who packed what. Please add this line to the desktop doc and the stow checklist: **one package, one person**.

### 3.8 Empty SKU rows
- For a manual confirm of an item without a SKU, the phone sends `"sku": ""`.
- The server should store `''`, not NULL, so that `packing._fill`'s `items_matching(normalize(''))` matches the empty-SKU item. It should return `sku: ""` in `scans[]`.

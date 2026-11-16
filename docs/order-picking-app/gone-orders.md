# Pick: say why a picked order left the list (server request)

Status: 2026-11-16, written by the app side for the `fp_ops` server team. **Implemented on the server 2026-11-16, and the app reads it.** `open` is only sent when the whole order is off the list but still waiting to ship. Read with `requirements.md` in this folder. This doc only covers what changes. Nothing else in Pick changes.

## 1. Why

The Pick home screen has a section called **"Picked, order gone"**. It lists items that were picked, but whose order then dropped off `GET /pick-list`. It's meant for **cancelled orders**: the item was taken out of its box, and nobody will ship it, so it must go back.

The trouble is that an order also drops off the list when it **ships**. The list only holds orders that are waiting to ship (`fulfillment_status = 'NOT_STARTED' AND payment_status = 'PAID'`). So every order that's picked and then shipped as normal lands in that section too. Two weeks of normal shipping filled it with items that had already left the building.

The phone can't tell "shipped" from "cancelled" on its own. The pick list says only that the order is gone, not why. Today the phone guesses from Pack's data: if Pack has the order as packed, it shipped. That fails whenever Pack never loaded the order.

### The case that shows it (2026-11-16)

Order `shopify_19021657604346`, 3 items (AAO-0809-040, AAO-0809-024, AAO-0806-008):

| | |
|---|---|
| Picked | 2026-11-14 06:48–06:50 UTC, from Y-8, Y-8, Y-5 |
| Shipped | Shopify fulfillment, USPS label, 2026-11-14 19:13 UTC. `orders_cache`: `FULFILLED` / `PAID` |
| In Pack | Not at all (no `packing_orders` row) |

Load labels fetches the last 24 h. Load #10 ran at 2026-11-14 07:14 UTC and load #11 at 2026-11-15 22:07 UTC, which left a gap from 07:14 to 22:07 on 11-14. The label was bought inside that gap, so Pack never saw the order, and the phone still tells the user to put back three items that shipped.

The server already knows the answer: `orders_cache.fulfillment_status` is `FULFILLED`. This request is to pass that on.

## 2. The change: `gone_orders` on `GET /pick-list`

Add one field to the response. Everything else stays as it is.

```json
{
  "snapshot_id": "…",
  "generated_at": "2026-11-16T22:10:00Z",
  "lines": [ … unchanged … ],
  "gone_orders": [
    { "order_id": "shopify_19021657604346", "status": "shipped",   "at": "2026-11-14T19:13:24Z" },
    { "order_id": "24-15393-24533",         "status": "cancelled", "at": "2026-11-15T09:02:11Z" }
  ]
}
```

### Which orders to include
Every order that meets all three of these:
1. It has at least one line with `picked_qty > 0` in `pick_line_status`.
2. It isn't in this response's `lines`.
3. It was on a pick list in the **last 7 days** (any `pick_snapshot_lines` row in a snapshot from the last 7 days).

The phone drops these items after 7 days, so older orders aren't needed. The list stays short: a few hundred at most.

### Fields
- **`order_id`**: exactly as in `lines[].order_id`, so Shopify orders keep the `shopify_` prefix. The phone matches on this value as it is, with no store or prefix handling.
- **`status`**: what happened to the order, from the server's own records:

  | `status` | Meaning for the phone | Suggested rule (`orders_cache`) |
  |---|---|---|
  | `shipped` | Left the building. Nothing to put back. **Not listed.** | `fulfillment_status` is `FULFILLED` or partly fulfilled, whatever the payment status. A refund after shipping is a return, which is handled elsewhere |
  | `cancelled` | Won't ship. **Put the items back.** | Not fulfilled, and refunded or cancelled: e.g. `NOT_STARTED` + `FULLY_REFUNDED`, or a cancelled eBay order |
  | `open` | The order is still waiting to ship, but this line isn't on the list. Most likely the line's SKU changed, so its `line_key` changed | Still `NOT_STARTED` + `PAID` |
  | `unknown` | The server can't tell (e.g. no `orders_cache` row) | Anything else |

  The exact rules are the server team's call, especially for partial refunds and eBay cancellations, since you know how those look in `orders_cache`. If an order shipped part of its items and cancelled the rest, `shipped` is fine for now.
- **`at`**: when that happened, if known: `shipped_date` for `shipped`, the cancel or refund time for `cancelled`. UTC ISO-8601 with `Z`, or `null`. The phone uses it for the day the item is grouped under. If it's `null`, the phone uses the time it noticed the order had gone.

### Speed
`?resync=0` (the quick reload) must stay quick. This is one query over `pick_line_status`, `pick_snapshot_lines` and `orders_cache`, with no eBay or Shopify calls. With `?resync=1`, use `orders_cache` as it is after the re-sync, so a cancellation made on eBay a minute ago is counted.

### Compatibility
The field is additive. Today's app ignores it, and the next app treats a missing field as "no information" and falls back to Pack's data. The server and the app can ship in either order.

## 3. What the app will do (for context)

For each picked line that dropped off the list:

| `gone_orders` says | Shown in "Picked, order gone"? |
|---|---|
| `shipped` | No |
| `cancelled` | Yes, marked **Order cancelled**, with the box it was picked from |
| `open` | Yes, marked **Line changed on the order**, so someone checks it before putting anything back |
| `unknown`, or not in `gone_orders` | Falls back to Pack: hidden if Pack has the order as packed, otherwise shown as today |

The section is already grouped by day, and items drop off after 7 days (done on the app side, 2026-11-16).

## 4. Test cases

| Case | Expected in `gone_orders` |
|---|---|
| `shopify_19021657604346` above (picked, `FULFILLED`, never in Pack) | `shipped`, `at` 2026-11-14T19:13:24Z |
| Picked eBay order, then shipped and packed in Pack | `shipped` |
| Picked order, then cancelled and refunded before shipping | `cancelled` |
| Picked order, shipped, then refunded (a return) | `shipped` |
| Order on the list but never picked, then shipped | Not included (nothing was picked) |
| Picked order still waiting to ship, whose line's SKU was edited on the sheet | Not included: the order is still on the list (rule 2). The phone falls back to Pack's data for that line |
| Picked order that left the list 8+ days ago | Not included |
| Order still on the list | Not included |
| `?resync=0` | Same field, no extra API calls, response time about as today |

## 5. Rollout
1. Server: add `gone_orders` to `GET /pick-list` (both `resync=0` and `resync=1`). Update the endpoint section of `requirements.md`, or tell the app side and we'll update it.
2. App: reads `gone_orders` when it's present, otherwise works as today.
3. Snapshots: storing `gone_orders` in `pick_snapshots` isn't needed. If it's easy, keeping it with the snapshot would help explain later what the phone was told.

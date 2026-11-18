# End + Pull requirements: review and decisions

Status: 2026-11-17. From the app team (product_listings), for the fp_ops / ebay_seller_port server team to review.
Reviews `fp_ops/docs/end-and-pull-requirements.md` ("the requirements"; `§n` = its sections).
The app design is in `docs/pull-app/design.md`.

> **Update:** revision 3 of the requirements adopts all of these decisions and settles the open points.
> New follow-up points for the server team are in `design.md` §7.

Each item lists the problem we found, the owner's decision, and what it means for the server.

---

## 1. Order: the eBay end comes first, then the pull

**Problem.** §3 and §11 make the eBay end and the pull independent. If stock is pulled and disposed while the
listing is still live, a buyer can still buy it, and there's nothing to ship. §2 says disposal is final, but
§6.2 and §8 expect pulled items to be "put back" when an End is cancelled or the listing sells after the
pull. Both can't be true.

**Decision.** The listing is ended on eBay **before** the pull. This answers open decision §11-2.

**For the server:**
- The Pull list's source becomes: End actions that are `open` **and** have eBay end status `ended`. Actions
  still `pending` or `failed` don't appear.
- A listing that's ended can't sell, so these rows in the requirements can no longer happen and can be
  removed:
  - §8 "Listing sells after it was pulled"
  - §7 "Pulled but still live on eBay"
- Cancelling an End after the eBay end stays as in §4.1: cancelled and flagged. Relisting is a manual
  decision. Cancelling after a pull means the stock is already gone, so it is reported, not re-stowed.

## 2. Overselling a pulled listing

**Problem.** A listing pulled before it ended can still sell (see 1).

**Decision.** This can't happen once rule 1 is enforced. No extra work is needed.

## 3. An out-of-date list, and SKUs that are on an open order

**Problem.** A sale between loading the list and pulling would mean disposing of a sold item. Separately,
§6.1 ("the order wins") needs to know about open orders, and the pull list doesn't carry that.

**Decision.** Rule 1 removes the sale risk: ended listings don't sell. **We still need to check whether
any SKU to be pulled is on an open order.** That covers an order placed just before the end, and the same
SKU being sold through another listing.

**For the server:**
- When building the list, mark any line whose SKU is on an open order, and leave out the units that order
  needs.
- Repeat the check **when each pull event is received** (see 4). Reject the pull if the SKU is needed for an
  open order, and say so in the reply.

## 4. Pull only works online

**Problem.** §6.2 copies Pick's offline mode: events are queued on the phone and sent later. For an action
that can't be undone, that means the server can only find out about a problem after the item is gone.

**Decision.** **No pulling while offline.** Every pull must be accepted by the server before the phone
counts it.

**For the server:**
- `POST /pull-events` is called once per scan and answered right away, with each event either accepted or
  rejected with a reason. Reasons include: the action was cancelled, the SKU is needed for an order, the
  line is already complete, or it isn't on the list.
- The event ID stays the idempotency key, so a retry after a timeout is safe.
- §5.3 "batches are accepted" and §6.2 "Offline" no longer apply to Pull. Order Pick doesn't change.
- The app turns scanning off and shows "Pull needs the Mac" while the server can't be reached.

## 5. One SKU, one box. One pull line per SKU

**Problem.** Two End actions on the same SKU would each say "pull all units of the SKU", so the units are
counted twice. A SKU found in several boxes leaves it unclear which location rows to remove (§5.4).

**Decision.**
- The rule already in place: **all units of a SKU are in one box, never split.**
- Two ended listings with the same SKU are fine. The pull takes **all units of that SKU**.
- **The Pull list must not have duplicate SKUs.**

**For the server:**
- **Before implementation, verify the rule on the live data:** list any SKU that has location rows in more
  than one box, and fix those first. Also add the check to the location integrity checks, so a split is
  flagged as a location issue from then on.
- One pull line **per SKU**, not per End action. The line carries every End action ID for that SKU. When the
  line is completed, the pull status of every one of those actions is updated.
- The line key is the SKU, plus something unique to the round, so an old event can't apply to a later pull
  of the same SKU.
- Once the line is complete, the SKU's single location row is removed.
- **Still open:** what if the SKU is *also* on a live listing that isn't being ended (§5.2, §8)? "Pull all
  units" would empty the stock that listing sells. Proposal: such a SKU doesn't go on the Pull list, and the
  End is flagged in the console for a decision.

## 6. One scan = one unit. Unknown counts. Bundles

**Problem.** §5.2 pulls "the listing's remaining quantity" when the unit count is unknown, which may not
match what is really in the box. §8 says that ending a bundle doesn't pull its components, which leaves dead
stock on the shelf.

**Decision.**
- **Each scan pulls one unit of the SKU.** A SKU with several units needs each unit scanned.
- **When the unit count isn't on record, count the scans.** The number pulled is however many units were
  scanned.
- **A bundle listing is expanded into its member SKUs,** using the bundles table in the database, the same
  way order Pick does. Each member SKU is pulled like any other SKU. This replaces the §8 "Bundle listing"
  row.

**For the server:**
- `units_to_pull` = the units on record. When the count is unknown, send `null`. The phone then counts scans,
  and the picker finishes the line with an explicit "No more in this box" (recorded as an event), because
  there is no number to reach.
- On completion, remove the location row whether or not its count was known. Record the scanned count in the
  ledger.
- Bundle members follow rule 5:
  - Each member SKU is one line, with no duplicates. If two ended bundles share a member, or a member is
    also ended on its own, there is still only one line.
  - **Still open:** a member that is also part of another bundle that stays live, or is sold on its own
    live listing. The proposal is the same as in 5: leave it off the list and flag it in the console.

---

## Still open (no decision yet)

1. A SKU that is shared with a live listing which isn't being ended, or a bundle member that is still
   needed elsewhere (5, 6).
2. Should a `missing` pull ever close? Proposal: never on its own. Add an explicit "write off" in the
   console, kept in the history.
3. Undoing a pull after the line completed: recreate the location row exactly as it was before, taken from
   the ledger.

## Summary of changes to the requirements

| Requirements section | Change |
|---|---|
| §3, §11-2 | The eBay end must come before the pull. |
| §5.2 source | Only `open` actions with eBay end `ended`. |
| §5.2 lines | One line per SKU, not one per action. No duplicate SKUs. Bundles expanded to their members. |
| §5.2 units | Units on record, or `null` (count the scans) when unknown. Remove the "listing quantity" fallback. |
| §5.3, §6.2 | Pull is online only, with one event per request answered right away. No offline queue. |
| §5.4 | A location row is removed when its line completes. The one-SKU-one-box rule is checked. |
| §6.1 | The open-order check happens on the server, at list time and on every pull event. |
| §7, §8 | Remove the "sold after pull" and "pulled but still live" cases. Bundle row replaced. |

---

## Round 2: questions on revision 4 (2026-11-17)

Revision 4 adopted all of our earlier feedback. Below is what is still open, plus one point now settled for
the record. Details are in `design.md` §4 (data contract) and §7.

### Q1. Tell the phone when the order sync is broken

**Problem.**
- The owner's rule is "no pulling while the order sync is broken" (§5.2). Today the server knows only while
  `GET /pull-list` is running.
- Each order sync (`fp_ops/resync.py`, the same run behind `GET /pick-list?resync=1`) ends as `ok`, `failed`
  or `timeout`. The result isn't kept anywhere.
- So a phone that loaded the list earlier can't find out that a later sync failed.

**Owner's decision.** When the server fails to sync orders, Pull is disabled in the app.

**Ask:**
1. **Record the latest order sync result and time,** whether Pick or Pull started the run.
   - For Pull, **`timeout` counts as failed.** Pick serves the current data on a timeout while the sync
     keeps running. Pull must not.
2. **Report it on `GET /health`,** which the app already checks every 30 seconds:
   `"orders_sync": { "ok": true|false, "at": "<time of the latest sync>" }`.
3. **As a safety net,** reject `pull`, `finish` and `missing` with `orders_not_synced` while the latest sync
   has failed.

**App:** Pull is off (scanner and all pull buttons) whenever any of these happened:
- the list load returned `orders_not_synced`
- `/health` says the latest sync failed
- an event came back `orders_not_synced`

It comes back on when a reload syncs successfully.

**No age limit.** We are not asking for an "older than N minutes" limit. Ended listings can't take new sales,
and the sync before the list catches orders placed before the end. So only a failed latest sync matters.

### Q2. Request and reply format of `POST /pull-event`

Please confirm this format, or send the server's:

```json
// request
{ "device": "iPhone 11 / app 1.4.0",
  "event": { "event_id": "uuid", "snapshot_id": "…", "line_key": "…", "sku": "…",
             "expected_box_id": "…", "box_id": "…",
             "action": "pull | finish | missing | undo | reject",
             "method": "scan | manual", "scanned_value": "…", "note": null, "at": "…" } }

// reply
{ "event_id": "uuid", "accepted": true, "reason": null,
  "line": { "line_key": "…", "pulled_qty": 3, "units_to_pull": 3,
            "status": "pending | partly_pulled | pulled | missing", "complete": true } }
```

For the list, `GET /pull-list` follows `design.md` §4: one line per SKU, with `actions[]` carrying
`action_id`, `item_id`, `store` and `bundle_sku`.

### Settled: bundle members are treated like any other SKU

Owner's decision. This matches how order Pick already does it (`fp_ops/picklist.py`,
`_bundle_components`):
- **Membership** comes from `bundle_listings`.
- **Title** is the member's own `item_title`.
- **Box and room** are the member's own `inventory_locations` row.
- **Photos** are the member SKU's own, served by the Mac (`/images/<sku>/…`).
- **One difference from Pick:** a Pull line's SKU is the plain member SKU, not `BUNDLE:MEMBER`, so
  duplicates merge into one line. The bundle SKU appears only on the line's actions (`bundle_sku`).

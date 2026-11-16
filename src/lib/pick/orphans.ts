import type { PackageState } from '../pack/derive';
import type { OrphanLine } from './store';
import type { GoneOrder } from './types';

// "Picked, order gone": picked lines that dropped off a later pick list. Most
// left because the order shipped as normal, so only the ones that may still
// need putting back are shown, grouped by day. Why an order left comes from the
// server's gone_orders, else from Pack's data (an older server, or an order the
// server didn't report).

/** Older ones drop off, like Pack's list of packed orders. */
export const KEEP_ORPHANS_MS = 7 * 24 * 3600 * 1000;

export type OrphanItem = {
  orphan: OrphanLine;
  /** Where it goes back: the box it was picked from, else the line's box. */
  box: string | null;
  /** The order was cancelled: put the item back. */
  cancelled: boolean;
  /** The order is still waiting to ship but this line left it (e.g. its SKU changed): check first. */
  lineChanged: boolean;
};

export type OrphanDay = {
  key: string;
  /** "Today", "Yesterday", or "Mon 11-10". */
  label: string;
  /** Newest first. */
  items: OrphanItem[];
};

export type OrphanGroups = {
  /** Newest day first. */
  days: OrphanDay[];
  count: number;
  /** Shipped (server, or packed in Pack), so nothing goes back. Not listed. */
  shipped: number;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(d: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) {
    return 'Today';
  }
  if (dayKey(d) === dayKey(yesterday)) {
    return 'Yesterday';
  }
  return `${WEEKDAYS[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The same order in Pick and Pack. Pick's Shopify IDs carry a store prefix
 * (`shopify_19027409043706`) that Pack's don't (`19027409043706`).
 */
export function orderKey(store: string, orderId: string): string {
  const prefix = `${store}_`;
  return `${store}:${orderId.startsWith(prefix) ? orderId.slice(prefix.length) : orderId}`;
}

export function isRecentOrphan(orphan: OrphanLine, now: number): boolean {
  return now - new Date(orphan.removedAt).getTime() < KEEP_ORPHANS_MS;
}

export function groupOrphans(
  orphans: OrphanLine[],
  goneOrders: GoneOrder[] | undefined,
  packages: PackageState[],
  now = new Date()
): OrphanGroups {
  const gone = new Map((goneOrders ?? []).map((g) => [g.order_id, g]));
  const packOrders = new Map<string, { cancelled: boolean; packed: boolean }>();
  for (const pkg of packages) {
    for (const o of pkg.orders) {
      packOrders.set(orderKey(o.order.store, o.order.order_id), {
        cancelled: o.order.cancelled,
        packed: o.packedAt !== null,
      });
    }
  }

  let shipped = 0;
  const days: OrphanDay[] = [];
  const recent = orphans
    .filter((o) => isRecentOrphan(o, now.getTime()))
    .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
  for (const orphan of recent) {
    const server = gone.get(orphan.line.order_id);
    const pack = packOrders.get(orderKey(orphan.line.store, orphan.line.order_id));
    const known = server && server.status !== 'unknown' ? server.status : null;
    const cancelled = known ? known === 'cancelled' : (pack?.cancelled ?? false);
    if (known === 'shipped' || (!known && pack?.packed && !pack.cancelled)) {
      shipped += 1;
      continue;
    }
    // Grouped by when it was cancelled, if the server knows, else when it left the list.
    const at = new Date(server?.at ?? orphan.removedAt);
    const key = dayKey(at);
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = { key, label: dayLabel(at, now), items: [] };
      days.push(day);
    }
    day.items.push({
      orphan,
      box: orphan.pickedFromBox ?? orphan.line.box_id,
      cancelled,
      lineChanged: known === 'open',
    });
  }

  return { days, count: days.reduce((n, d) => n + d.items.length, 0), shipped };
}

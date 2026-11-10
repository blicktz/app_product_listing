import type { LocalPackEvent, PackItem, PackOrder, PackPackage, PackScanKind, PackScanRow, PackSource } from './types';

// Pure derivations: the packing board the screens show, computed from the last
// GET /pack-state plus this phone's events the Mac hasn't counted yet.
// A port of ops_console/packing.py (_fill, Package, _finish_if_done), so the
// phone, the desktop and the server agree on what a set of scans means.

/** Letters and digits only, upper-cased (packing.normalize). */
export function normalize(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type ItemState = {
  item: PackItem;
  count: number;
  /** Confirmed by hand (Found it) at least once. */
  manual: boolean;
  complete: boolean;
  /** The order's name, set only in a package with several orders. */
  orderName: string | null;
};

export type OrderState = {
  order: PackOrder;
  labelScanned: boolean;
  manualPacked: boolean;
  /** Active ok rows of any kind. */
  scans: number;
  packedAt: string | null;
};

export type PackageStatus = 'todo' | 'started' | 'packed' | 'cancelled' | 'multi_label';

export type PackageState = {
  pkg: PackPackage;
  key: string;
  orders: OrderState[];
  items: ItemState[];
  /** Active rows: the server's (insert order), then this phone's unsent ones. */
  rows: PackScanRow[];
  labelScanned: boolean;
  manualPacked: boolean;
  scans: number;
  /** Set when every order in the package is packed (the newest time). */
  packedAt: string | null;
  /** Which app packed it: this phone's own unsent event, else the server's packed_source. */
  packedSource: PackSource | null;
  /** No items: it can only leave To pack through Mark packed. */
  noItems: boolean;
  cancelled: boolean;
  cancelledNames: string[];
  packable: boolean;
  doneItems: number;
  totalItems: number;
  itemsComplete: boolean;
  /** Packable, label scanned and every item accounted for. */
  isDone: boolean;
  status: PackageStatus;
};

export type Board = {
  /** Server order: to pack (oldest label first), then packed (newest first). */
  packages: PackageState[];
  byKey: Map<string, PackageState>;
  /** order_key → package key. */
  orderIndex: Map<string, string>;
};

/** Items a scanned SKU counts for: the item itself, or every component of a scanned bundle. */
export function itemsMatching<T extends { item: PackItem }>(items: T[], scanNorm: string): T[] {
  const direct = items.filter((i) => normalize(i.item.sku) === scanNorm);
  return direct.length > 0
    ? direct
    : items.filter((i) => i.item.parent_sku !== null && normalize(i.item.parent_sku) === scanNorm);
}

/** Events the Mac hasn't counted in the current state (same rule as Pick). */
export function isUnreflected(local: LocalPackEvent, fetchStartedAt: number | null): boolean {
  return local.acceptedAt === null || fetchStartedAt === null || local.acceptedAt > fetchStartedAt;
}

type Work = {
  pkg: PackPackage;
  rows: PackScanRow[];
  packedAt: Map<string, string | null>;
  /** null: as the server says; else set by this phone's unsent events. */
  packedLocally: boolean | null;
};

function build(work: Work): PackageState {
  const { pkg } = work;
  const multi = pkg.orders.length > 1;
  const orders: OrderState[] = pkg.orders.map((order) => ({
    order,
    labelScanned: false,
    manualPacked: false,
    scans: 0,
    packedAt: work.packedAt.get(order.order_key) ?? null,
  }));
  const orderByKey = new Map(orders.map((o) => [o.order.order_key, o]));
  const nameByKey = new Map(pkg.orders.map((o) => [o.order_key, o.name]));
  const items: ItemState[] = pkg.items.map((item) => ({
    item,
    count: 0,
    manual: false,
    complete: false,
    orderName: multi ? (nameByKey.get(item.order_key) ?? null) : null,
  }));

  for (const row of work.rows) {
    const order = orderByKey.get(row.order_key);
    if (!order) {
      continue;
    }
    order.scans += 1;
    if (row.kind === 'label') {
      order.labelScanned = true;
    } else if (row.kind === 'manual_packed') {
      order.manualPacked = true;
    } else {
      // Only the items of the order the row was recorded on (packing._fill).
      const own = items.filter((i) => i.item.order_key === row.order_key);
      for (const i of itemsMatching(own, normalize(row.sku))) {
        i.count += 1;
        if (row.kind === 'manual') {
          i.manual = true;
        }
      }
    }
  }
  for (const i of items) {
    i.complete = i.count >= i.item.qty;
  }

  const stamps = orders.map((o) => o.packedAt);
  const packedAt = stamps.length > 0 && stamps.every(Boolean) ? (stamps as string[]).sort().at(-1)! : null;
  const cancelledNames = orders.filter((o) => o.order.cancelled).map((o) => o.order.name);
  const cancelled = cancelledNames.length > 0;
  const packable = pkg.label_count === 1 && !cancelled;
  const labelScanned = orders.length > 0 && orders.every((o) => o.labelScanned);
  const itemsComplete = items.length > 0 && items.every((i) => i.complete);
  const scans = orders.reduce((n, o) => n + o.scans, 0);
  const status: PackageStatus = packedAt
    ? 'packed'
    : cancelled
      ? 'cancelled'
      : pkg.label_count > 1
        ? 'multi_label'
        : scans > 0
          ? 'started'
          : 'todo';

  return {
    pkg,
    key: pkg.key,
    orders,
    items,
    rows: work.rows,
    labelScanned,
    manualPacked: orders.some((o) => o.manualPacked),
    scans,
    packedAt,
    packedSource: !packedAt ? null : work.packedLocally ? 'phone' : (pkg.packed_source ?? null),
    noItems: items.length === 0,
    cancelled,
    cancelledNames,
    packable,
    doneItems: items.reduce((n, i) => n + Math.min(i.count, i.item.qty), 0),
    totalItems: items.reduce((n, i) => n + i.item.qty, 0),
    itemsComplete,
    isDone: packable && labelScanned && itemsComplete,
    status,
  };
}

const SCAN_KINDS = new Set<string>(['label', 'sku', 'manual', 'manual_packed']);

export function deriveBoard(
  packages: PackPackage[],
  events: LocalPackEvent[],
  fetchStartedAt: number | null
): Board {
  const works = new Map<string, Work>();
  const orderIndex = new Map<string, string>();
  for (const pkg of packages) {
    works.set(pkg.key, {
      pkg,
      rows: [...pkg.scans],
      packedAt: new Map(pkg.orders.map((o) => [o.order_key, o.packed_at])),
      packedLocally: null,
    });
    for (const o of pkg.orders) {
      orderIndex.set(o.order_key, pkg.key);
    }
  }

  const workFor = (packageKey: string | null, orderKeys: string[]): Work | undefined => {
    if (packageKey && works.has(packageKey)) {
      return works.get(packageKey);
    }
    for (const k of orderKeys) {
      const key = orderIndex.get(k);
      if (key) {
        return works.get(key);
      }
    }
    return undefined;
  };

  const local = events
    .filter((e) => isUnreflected(e, fetchStartedAt))
    .sort((a, b) => a.event.seq - b.event.seq);

  for (const { event } of local) {
    const work = workFor(event.package_key, event.order_keys);
    if (!work) {
      continue;
    }
    const orderKeys = work.pkg.orders.map((o) => o.order_key);

    if (event.kind === 'undo') {
      const refs = new Set(event.undoes ?? []);
      const kept = work.rows.filter((r) => !refs.has(r.ref));
      if (kept.length === work.rows.length) {
        continue; // already undone (e.g. on the desktop): nothing changes
      }
      work.rows = kept;
      // Like the server: a package still complete after the undo stays packed.
      if (!build(work).isDone) {
        for (const k of orderKeys) {
          work.packedAt.set(k, null);
        }
        work.packedLocally = null;
      }
      continue;
    }
    if (event.result !== 'ok' || !SCAN_KINDS.has(event.kind)) {
      continue;
    }
    // Already in the server's rows (belt and braces: sending pauses during a fetch).
    if (work.pkg.scans.some((r) => r.ref === event.event_id)) {
      continue;
    }
    const kind = event.kind as PackScanKind;
    const targets =
      kind === 'label' || kind === 'manual_packed' ? event.order_keys : event.order_keys.slice(0, 1);
    for (const orderKey of targets) {
      work.rows.push({ ref: event.event_id, order_key: orderKey, kind, sku: event.sku, at: event.at, source: 'phone' });
    }

    if (kind === 'manual_packed') {
      if (event.order_keys.some((k) => !work.packedAt.get(k))) {
        work.packedLocally = true;
      }
      for (const k of event.order_keys) {
        if (!work.packedAt.get(k)) {
          work.packedAt.set(k, event.at);
        }
      }
      continue;
    }
    // The moment a package is complete, all its orders are packed (_finish_if_done).
    const state = build(work);
    if (state.isDone && !state.packedAt) {
      for (const k of orderKeys) {
        if (!work.packedAt.get(k)) {
          work.packedAt.set(k, event.at);
        }
      }
      work.packedLocally = true;
    }
  }

  const states = [...works.values()].map(build);
  return { packages: states, byKey: new Map(states.map((s) => [s.key, s])), orderIndex };
}

function atMs(at: string): number {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
}

export type UndoTarget = {
  kind: PackScanKind;
  sku: string | null;
  source: PackSource | null;
  refs: string[];
};

/**
 * Rows the next Undo takes back: the newest active row by `at` (ties: the later
 * in the list), with its siblings on the other orders. By time, not position:
 * a phone row uploaded late sits after newer desktop rows in the server's list.
 */
export function undoTarget(state: PackageState): UndoTarget | null {
  let last: PackScanRow | null = null;
  for (const row of state.rows) {
    if (!last || atMs(row.at) >= atMs(last.at)) {
      last = row;
    }
  }
  if (!last) {
    return null;
  }
  const source = last.source ?? null;
  if (last.kind !== 'label' && last.kind !== 'manual_packed') {
    return { kind: last.kind, sku: last.sku, source, refs: [last.ref] };
  }
  // A label scan or Mark packed was written once per order, at the same time
  // (the server keeps whole seconds).
  const second = Math.floor(atMs(last.at) / 1000);
  const { kind, ref } = last;
  const refs = new Set(
    state.rows
      .filter((r) => r.ref === ref || (r.kind === kind && Math.floor(atMs(r.at) / 1000) === second))
      .map((r) => r.ref)
  );
  return { kind, sku: last.sku, source, refs: [...refs] };
}

// --- Display helpers -------------------------------------------------------------

const STORE_SHORT: Record<string, string> = {
  foundandprofound: 'F&P',
  toptierpulls: 'TTP',
  shopify: 'Shopify',
};

export function shortStore(store: string): string {
  return STORE_SHORT[store] ?? store;
}

/** "9400 1000 …" for an all-digit tracking number. */
export function spacedTracking(tracking: string | null): string {
  const t = tracking ?? '';
  return /^\d+$/.test(t) ? (t.match(/.{1,4}/g) ?? []).join(' ') : t;
}

export function sameLocalDay(iso: string, day: Date = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
}

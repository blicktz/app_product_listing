// Wire types for the Mac portal's pack API. See docs/pack-app/requirements.md
// (Part B). All times are UTC ISO-8601 with Z.

export type PackScanKind = 'label' | 'sku' | 'manual' | 'manual_packed';
export type PackEventKind = PackScanKind | 'undo';
export type PackResult = 'ok' | 'dup' | 'wrong' | 'ambiguous' | 'unknown';
export type PackSource = 'phone' | 'desktop';

export type PackOrder = {
  order_key: string;
  store: string;
  order_id: string;
  /** channel_name (Shopify #1013) or the order ID. */
  name: string;
  cancelled: boolean;
  packed_at: string | null;
};

export type PackItem = {
  order_key: string;
  seq: number;
  sku: string;
  /** BUD- bundle this item is a component of. */
  parent_sku: string | null;
  title: string | null;
  qty: number;
  room: string | null;
  box_id: string | null;
  box_label: string | null;
  image_url: string | null;
  image_url_full: string | null;
};

/** An active packing_scans row: result ok, not an undo, not undone. */
export type PackScanRow = {
  /** event_id for rows sent by a phone, else `scan:<scan_id>`. Shared by the rows of one event. */
  ref: string;
  order_key: string;
  kind: PackScanKind;
  sku: string | null;
  at: string;
  /** Which app made the row (added for the parallel run; may be missing). */
  source?: PackSource;
};

export type PackPackage = {
  /** The first order's order_key. */
  key: string;
  name: string;
  store: string;
  buyer: string | null;
  ship_city: string | null;
  ship_state: string | null;
  tracking: string | null;
  tracking_norm: string | null;
  carrier: string | null;
  label_time: string | null;
  label_count: number;
  orders: PackOrder[];
  items: PackItem[];
  scans: PackScanRow[];
  /** How it was packed: by scans, scans + hand confirms, or marked by hand (null if not packed). */
  packed_by?: 'scan' | 'scan+hand' | 'hand' | null;
  /** Which app set packed_at (null if not packed). */
  packed_source?: PackSource | null;
  /** The order has no items: it can only leave To pack through Mark packed. */
  item_count_zero?: boolean;
};

export type PackLoad = {
  loaded_at: string;
  hours: number;
  orders_found: number | null;
  orders_new: number | null;
};

export type PackServerState = {
  generated_at: string;
  load_status: 'no' | 'ok' | 'failed' | 'timeout';
  load_error: string | null;
  last_load: PackLoad | null;
  packages: PackPackage[];
  /** A Load labels is running on the Mac (started by the phone or the desktop). */
  load_running?: boolean;
  /** Changes whenever scans, loads or packed status change. */
  server_version?: string | number | null;
};

/** An event the Mac accepted but didn't count: its package was already packed. */
export type PackConflict = {
  event_id: string;
  reason: string;
  package_key: string | null;
  packed_at: string | null;
  packed_source: PackSource | null;
};

export type PackEventsResponse = {
  accepted: string[];
  conflicts?: PackConflict[];
};

export type PackEvent = {
  event_id: string;
  /** Goes up by exactly 1 per event on this install, so lost events show as gaps. */
  seq: number;
  at: string;
  kind: PackEventKind;
  result: PackResult;
  /** Package open or targeted when it happened. */
  package_key: string | null;
  /** Orders that get a packing_scans row (empty: one row with no order). */
  order_keys: string[];
  sku: string | null;
  /** Raw scan text as received. */
  raw: string | null;
  /** undo only: refs of the rows taken back. */
  undoes: string[] | null;
};

export type LocalPackEvent = {
  event: PackEvent;
  /** ms when the Mac accepted it; null while queued. */
  acceptedAt: number | null;
};

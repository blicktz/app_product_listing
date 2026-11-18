// Wire types for the Mac portal's Pull (dispose) API. See docs/pull-app/design.md §4
// and fp_ops/docs/end-and-pull-requirements.md §5.7. Separate from Pick's types on
// purpose: nothing here is an order line.

import type { NearbyBox } from '../pick/types';

/** One End action behind a pull line (several listings can share a SKU). */
export type PullLineAction = {
  action_id: number;
  item_id: string;
  store: string;
  /** Set when the line's SKU is a member of this ended bundle. */
  bundle_sku: string | null;
};

export type PullLineStatus = 'pending' | 'partly_pulled' | 'pulled' | 'missing';

export type PullLine = {
  /** SKU + this round's ID; an event for an earlier round can't apply to it. */
  line_key: string;
  /** Plain physical SKU (bundle members too, never BUNDLE:MEMBER). */
  sku: string;
  title: string;
  actions: PullLineAction[];
  image_url: string | null;
  image_url_full: string | null;
  room: string | null;
  /** null = unlocated. */
  box_id: string | null;
  other_boxes: string[];
  nearby_boxes: NearbyBox[];
  /** Units on record; null when the count isn't on record (count the scans, then finish). */
  units_to_pull: number | null;
  pulled_qty: number;
  missing_qty?: number;
  status: PullLineStatus;
  /** Earliest End decision on the line. */
  decided_at: string | null;
};

export type PullList = {
  snapshot_id: string;
  generated_at: string;
  /** When the orders this list was built on were synced. */
  orders_synced_at?: string | null;
  lines: PullLine[];
};

export type PullEventAction = 'pull' | 'finish' | 'missing' | 'undo' | 'reject';

export type PullEvent = {
  event_id: string;
  snapshot_id: string | null;
  line_key: string | null;
  sku: string | null;
  expected_box_id: string | null;
  box_id: string | null;
  action: PullEventAction;
  method: 'scan' | 'manual';
  scanned_value: string | null;
  note: string | null;
  at: string;
};

/** The line's state after an event, as the server sees it. */
export type PullLineUpdate = {
  line_key: string;
  pulled_qty: number;
  units_to_pull: number | null;
  missing_qty?: number;
  status: PullLineStatus;
  complete: boolean;
};

export type PullRejectReason =
  | 'action_cancelled'
  | 'needed_for_order'
  | 'line_complete'
  | 'not_on_list'
  | 'held'
  | 'old_round'
  | 'nothing_to_undo'
  | 'orders_not_synced';

export type PullEventReply = {
  event_id: string;
  accepted: boolean;
  /** A PullRejectReason, or a newer code this build doesn't know. */
  reason: string | null;
  line: PullLineUpdate | null;
};

/** `orders_sync` on GET /health (requirements §5.6). */
export type OrdersSync = {
  ok: boolean;
  state: 'ok' | 'failed' | 'running' | 'never';
  at: string | null;
};

// Wire types for the Mac portal's picking API. See
// docs/order-picking-app/requirements.md ("Server communication").

export type NearbyBox = {
  box_id: string;
  /** SKU range the box holds for this batch, e.g. "AAC-0621-001/020". */
  range: string;
};

export type ServerLineStatus = 'open' | 'picked' | 'missing';

export type PickLine = {
  /** order_id + custom_sku; stable across refreshes. */
  line_key: string;
  store: string;
  order_id: string;
  order_date: string;
  buyer: string;
  /** custom_sku as on the sheet; bundle components are "BUNDLE:COMPONENT". */
  sku: string;
  title: string;
  qty: number;
  image_url: string | null;
  image_url_full: string | null;
  room: string | null;
  /** null = unlocated (the sheet's NF). */
  box_id: string | null;
  other_boxes: string[];
  nearby_boxes: NearbyBox[];
  picked_qty: number;
  status: ServerLineStatus;
};

export type PickList = {
  snapshot_id: string;
  generated_at: string;
  lines: PickLine[];
};

export type PickAction = 'pick' | 'undo' | 'missing' | 'reject';

export type PickEvent = {
  event_id: string;
  snapshot_id: string | null;
  line_key: string | null;
  order_id: string | null;
  sku: string | null;
  expected_box_id: string | null;
  box_id: string | null;
  action: PickAction;
  method: 'scan' | 'manual';
  scanned_value: string | null;
  note: string | null;
  at: string;
};

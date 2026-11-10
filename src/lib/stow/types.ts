// Wire types for the Mac portal's stow API. See docs/stow-app/requirements.md
// ("Server requirements").

export type StowAction =
  | 'box_open'
  | 'stow'
  | 'adjust'
  | 'undo'
  | 'move_declined'
  | 'reject'
  | 'session_end';

export type StowEvent = {
  event_id: string;
  /** null only for a reject scanned while no session is open. */
  session_id: string | null;
  /** Goes up by exactly 1 per event on this install, so lost events show as gaps. */
  seq: number;
  action: StowAction;
  /** Printed label of the box open when it happened. */
  box_label: string | null;
  sku: string | null;
  /** stow: units added (null for a move). adjust: signed change. undo: units taken back. */
  units: number | null;
  moved_from_box: string | null;
  undoes_event_id: string | null;
  method: 'scan' | 'manual';
  scanned_value: string | null;
  note: string | null;
  at: string;
};

export type StowStateBox = {
  box_id: string;
  room: string | null;
  label: string | null;
};

export type StowStateLocation = {
  sku: string;
  box_label: string;
  /** null = count unknown. */
  units: number | null;
};

export type StowServerState = {
  generated_at: string;
  boxes: StowStateBox[];
  locations: StowStateLocation[];
};

export type LocalStowEvent = {
  event: StowEvent;
  /** ms when the Mac accepted it; null while queued. */
  acceptedAt: number | null;
  /** Phone-only: how many units a confirmed move carried, for the row's label. */
  movedUnits?: number | null;
};

import type { UploadDestination } from '../pick/store';

// The contract for POST /shoot-events and GET /shoot-state.
// See docs/shoot-mac-upload/requirements.md, Part 3.

export type ShootAction =
  | 'session_shot'
  | 'upload_complete'
  | 'upload_conflict'
  | 'upload_rejected'
  | 'upload_failed'
  | 'renumbered'
  | 'exported_to_photos'
  | 'deleted_from_phone';

export type ShootEventDetails = {
  numbers?: number[];
  shot_started_at?: string;
  shot_ended_at?: string;
  item_condition?: string | null;
  ebay_store?: string | null;
  destination?: UploadDestination;
  numbered_offline?: boolean;
  photo_count?: number;
  http_status?: number;
  error?: string;
  from_numbers?: number[];
  to_numbers?: number[];
};

export type ShootEvent = ShootEventDetails & {
  event_id: string;
  /** The upload job's ID. */
  session_id: string;
  /** Up by exactly 1 for every event on this install. */
  seq: number;
  action: ShootAction;
  date_root: string;
  sku: string;
  at: string;
};

export type ShootSessionStatus =
  | 'shot'
  | 'uploading'
  | 'complete'
  | 'conflict'
  | 'rejected'
  | 'failed'
  | 'abandoned';

export type ShootSessionSummary = {
  session_id: string;
  sku: string;
  date_root: string;
  shot_ended_at: string | null;
  photos_declared: number;
  photos_received: number;
  status: ShootSessionStatus;
  destination?: UploadDestination;
};

export type ShootServerState = {
  generated_at: string;
  sessions: ShootSessionSummary[];
};

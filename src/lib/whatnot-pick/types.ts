// Wire types for the Mac's Whatnot show pick API (fp_ops whatnot_pick.py).
// See docs/whatnot-pick/design.md §4.

import type { PickEvent } from '../pick/types';

export type ShowSummary = {
  plan_id: number;
  title: string;
  /** Local plan time, 'YYYY-MM-DDTHH:mm'. */
  scheduled_at: string | null;
  /** The linked Whatnot show's start (UTC ISO), when known. */
  whatnot_scheduled_at: string | null;
  whatnot_status: string | null;
  /** Plan items (lineup numbers). */
  n_lots?: number;
  /** Pieces to pick: a bundle counts once per component. */
  n_items: number;
  n_picked: number;
  n_sold: number;
  plan_version: string;
};

export type ShowIndex = {
  generated_at: string;
  /** The storage box show items are picked into, e.g. ST-PRE-WHT-001. */
  prep_box: string;
  shows: ShowSummary[];
};

export type WhatnotLineStatus = 'open' | 'picked' | 'missing' | 'sold';

export type WhatnotLine = {
  /** 'wn:<plan_id>:<sku>'; stable across renumbering. */
  line_key: string;
  /** Lineup number (#NN); can change when the plan is reordered on the Mac. */
  lot: number;
  sku: string;
  title: string | null;
  image_url: string | null;
  image_url_full: string | null;
  room: string | null;
  /** Where the item is now (the prep box once picked); null = no location on record. */
  box_id: string | null;
  status: WhatnotLineStatus;
  in_prep: boolean;
  previous_box: string | null;
  /**
   * Bundle pieces: a BUD-… plan item is picked as its components, like order
   * Pick. sku is then 'BUD-…:COMPONENT' (labelSku() gives the printed SKU),
   * every piece shares the bundle's lot, and the bundle is put together in the
   * prep box once all pieces are there. null for single items.
   */
  bundle_sku?: string | null;
  bundle_title?: string | null;
  bundle_size?: number | null;
  /** 1-based position in the bundle. */
  bundle_pos?: number | null;
};

export type RemovedInPrep = {
  line_key: string;
  sku: string;
  title: string | null;
  image_url: string | null;
  image_url_full: string | null;
  previous_box: string | null;
  bundle_sku?: string | null;
};

export type WhatnotPlan = {
  plan_id: number;
  title: string;
  scheduled_at: string | null;
  whatnot_scheduled_at: string | null;
  whatnot_status: string | null;
  number_width: number;
  prep_box: string;
  plan_version: string;
  generated_at: string;
  lines: WhatnotLine[];
  removed_in_prep: RemovedInPrep[];
};

/** A pick event plus the plan it belongs to (the Mac keys picks by plan + SKU). */
export type WhatnotEvent = PickEvent & { plan_id: number };

export type EventsReply = {
  accepted: string[];
  results?: Record<string, string>;
  plan_versions?: Record<string, string>;
};

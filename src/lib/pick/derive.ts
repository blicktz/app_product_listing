import type { PickEvent, PickLine, ServerLineStatus } from './types';

// Pure derivations: what the screens show, computed from the last pick list
// (server state) plus this phone's events the server hasn't folded in yet.

export type LocalEvent = {
  event: PickEvent;
  /** When the Mac accepted it (ms); null while still queued on the phone. */
  acceptedAt: number | null;
};

export type LineState = {
  line: PickLine;
  pickedQty: number;
  status: ServerLineStatus;
  /** From this phone's own events only (the server list has no times). */
  pickedAt: string | null;
  pickedFromBox: string | null;
  method: 'scan' | 'manual' | null;
  missingNote: string | null;
};

export type BoxGroup = {
  boxId: string;
  room: string | null;
  column: string;
  lines: LineState[];
  totalQty: number;
  pickedQty: number;
  /** Every line is picked or marked missing. */
  done: boolean;
};

export type ColumnGroup = {
  column: string;
  boxes: BoxGroup[];
};

/** The part of a custom SKU printed on the item's label (bundle → component). */
export function labelSku(sku: string): string {
  const colon = sku.lastIndexOf(':');
  return (colon >= 0 ? sku.slice(colon + 1) : sku).trim().toUpperCase();
}

/** Boxes of one prefix stand stacked in one warehouse column: AAC-3 → AAC. */
export function boxColumn(boxId: string): string {
  const dash = boxId.lastIndexOf('-');
  return dash > 0 ? boxId.slice(0, dash) : boxId;
}

/** Short order ID as printed on the picking sheet. */
export function shortOrderId(orderId: string): string {
  if (orderId.toLowerCase().startsWith('shopify_')) {
    return orderId.slice(-5);
  }
  const dash = orderId.lastIndexOf('-');
  return dash >= 0 ? orderId.slice(dash + 1) : orderId;
}

export function shortStore(store: string): string {
  return store.slice(0, 2).toUpperCase();
}

/** MM-DD from an ISO date. */
export function shortDate(date: string): string {
  return date.length >= 10 ? date.slice(5, 10) : date;
}

/** Natural order: AAC-3 before AAC-12. */
export function compareBoxIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Events the server hasn't counted in the current list: still queued, or
 * accepted after the list was fetched. Sending is paused during a fetch, so
 * nothing is accepted mid-fetch.
 */
function isUnreflected(local: LocalEvent, fetchStartedAt: number | null): boolean {
  return local.acceptedAt === null || fetchStartedAt === null || local.acceptedAt > fetchStartedAt;
}

export function applyEvent(state: LineState, event: PickEvent) {
  const qty = Math.max(1, state.line.qty);
  switch (event.action) {
    case 'pick':
      state.pickedQty = Math.min(qty, state.pickedQty + 1);
      state.status = state.pickedQty >= qty ? 'picked' : 'open';
      state.missingNote = null;
      break;
    case 'undo':
      // Undo clears a missing mark first; otherwise it takes back one pick.
      if (state.status === 'missing') {
        state.status = 'open';
        state.missingNote = null;
      } else {
        state.pickedQty = Math.max(0, state.pickedQty - 1);
        state.status = 'open';
      }
      break;
    case 'missing':
      state.status = 'missing';
      state.missingNote = event.note;
      break;
    case 'reject':
      break;
  }
}

export function deriveLineStates(
  lines: PickLine[],
  events: LocalEvent[],
  fetchStartedAt: number | null
): Map<string, LineState> {
  const states = new Map<string, LineState>();
  for (const line of lines) {
    states.set(line.line_key, {
      line,
      pickedQty: line.picked_qty ?? 0,
      status: line.status ?? 'open',
      pickedAt: null,
      pickedFromBox: null,
      method: null,
      missingNote: null,
    });
  }

  const sorted = [...events].sort((a, b) => a.event.at.localeCompare(b.event.at));
  for (const local of sorted) {
    const { event } = local;
    const state = event.line_key ? states.get(event.line_key) : undefined;
    if (!state) {
      continue;
    }
    if (isUnreflected(local, fetchStartedAt)) {
      applyEvent(state, event);
    } else if (event.action === 'missing') {
      state.missingNote = event.note;
    }
    // Display details come from every local event, counted or not.
    if (event.action === 'pick') {
      state.pickedAt = event.at;
      state.pickedFromBox = event.box_id;
      state.method = event.method;
    }
  }
  for (const state of states.values()) {
    if (state.pickedQty === 0) {
      state.pickedAt = null;
      state.pickedFromBox = null;
      state.method = null;
    }
  }
  return states;
}

export function isDone(state: LineState): boolean {
  return state.status === 'picked' || state.status === 'missing';
}

export function groupBoxes(states: Iterable<LineState>): Map<string, BoxGroup> {
  const boxes = new Map<string, BoxGroup>();
  for (const state of states) {
    const boxId = state.line.box_id;
    if (!boxId) {
      continue;
    }
    let box = boxes.get(boxId);
    if (!box) {
      box = {
        boxId,
        room: state.line.room,
        column: boxColumn(boxId),
        lines: [],
        totalQty: 0,
        pickedQty: 0,
        done: true,
      };
      boxes.set(boxId, box);
    }
    box.lines.push(state);
    box.totalQty += Math.max(1, state.line.qty);
    box.pickedQty += state.pickedQty;
    box.done = box.done && isDone(state);
  }
  for (const box of boxes.values()) {
    box.lines.sort((a, b) => a.line.sku.localeCompare(b.line.sku));
  }
  return boxes;
}

/** Open boxes grouped by column; finished boxes are returned separately. */
export function groupColumns(boxes: Map<string, BoxGroup>): {
  columns: ColumnGroup[];
  done: BoxGroup[];
} {
  const byColumn = new Map<string, BoxGroup[]>();
  const done: BoxGroup[] = [];
  for (const box of boxes.values()) {
    if (box.done) {
      done.push(box);
      continue;
    }
    const list = byColumn.get(box.column) ?? [];
    list.push(box);
    byColumn.set(box.column, list);
  }
  const columns = [...byColumn.entries()]
    .sort(([a], [b]) => compareBoxIds(a, b))
    .map(([column, list]) => ({
      column,
      boxes: list.sort((a, b) => compareBoxIds(a.boxId, b.boxId)),
    }));
  done.sort((a, b) => compareBoxIds(a.boxId, b.boxId));
  return { columns, done };
}

/** Every box ID the list mentions, so a scanned label can be told from a SKU. */
export function knownBoxIds(lines: PickLine[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.box_id) {
      ids.add(line.box_id.toUpperCase());
    }
    for (const box of line.other_boxes ?? []) {
      ids.add(box.toUpperCase());
    }
    for (const nearby of line.nearby_boxes ?? []) {
      ids.add(nearby.box_id.toUpperCase());
    }
  }
  return ids;
}

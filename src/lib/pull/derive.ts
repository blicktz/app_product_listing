import { boxColumn, compareBoxIds } from '../pick/derive';
import type { PullLine, PullLineUpdate } from './types';

// Pure derivations for the Pull screens: the last pull list with the server's
// answers to this phone's events applied. Box and column rules are Pick's, so
// the same labels group the same way.

export type PullLineState = PullLine & {
  /** Pulled to the count, finished ("no more in this box") or marked missing. */
  complete: boolean;
};

export type PullBox = {
  boxId: string;
  room: string | null;
  column: string;
  lines: PullLineState[];
  doneLines: number;
  /** Every line is complete. */
  done: boolean;
};

export type PullColumn = { column: string; boxes: PullBox[] };

/** A line's own completeness, for list lines without a server reply yet. */
function isCompleteOnList(line: PullLine): boolean {
  if (line.status === 'pulled' || line.status === 'missing') {
    return true;
  }
  return line.units_to_pull !== null && line.pulled_qty >= line.units_to_pull;
}

export function deriveLines(
  lines: PullLine[],
  updates: Record<string, PullLineUpdate>
): Map<string, PullLineState> {
  const states = new Map<string, PullLineState>();
  for (const line of lines) {
    const update = updates[line.line_key];
    states.set(
      line.line_key,
      update
        ? {
            ...line,
            pulled_qty: update.pulled_qty,
            units_to_pull: update.units_to_pull,
            missing_qty: update.missing_qty ?? line.missing_qty,
            status: update.status,
            complete: update.complete,
          }
        : { ...line, complete: isCompleteOnList(line) }
    );
  }
  return states;
}

/** Units still to pull on a line; null when its count isn't on record. */
export function unitsLeft(state: PullLineState): number | null {
  if (state.complete) {
    return 0;
  }
  return state.units_to_pull === null ? null : Math.max(0, state.units_to_pull - state.pulled_qty);
}

export function groupBoxes(states: Iterable<PullLineState>): Map<string, PullBox> {
  const boxes = new Map<string, PullBox>();
  for (const state of states) {
    const boxId = state.box_id;
    if (!boxId) {
      continue;
    }
    let box = boxes.get(boxId);
    if (!box) {
      box = { boxId, room: state.room, column: boxColumn(boxId), lines: [], doneLines: 0, done: true };
      boxes.set(boxId, box);
    }
    box.lines.push(state);
    if (state.complete) {
      box.doneLines += 1;
    }
    box.done = box.done && state.complete;
  }
  for (const box of boxes.values()) {
    box.lines.sort((a, b) => a.sku.localeCompare(b.sku));
  }
  return boxes;
}

/** Open boxes grouped by column; finished boxes separately. */
export function groupColumns(boxes: Map<string, PullBox>): { columns: PullColumn[]; done: PullBox[] } {
  const byColumn = new Map<string, PullBox[]>();
  const done: PullBox[] = [];
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
    .map(([column, list]) => ({ column, boxes: list.sort((a, b) => compareBoxIds(a.boxId, b.boxId)) }));
  done.sort((a, b) => compareBoxIds(a.boxId, b.boxId));
  return { columns, done };
}

/** "2 listings", "BUD-0101 member" or the store. */
export function actionsLabel(state: PullLineState): string {
  const bundles = [...new Set(state.actions.map((a) => a.bundle_sku).filter((b): b is string => Boolean(b)))];
  const parts: string[] = [];
  if (bundles.length > 0) {
    parts.push(`${bundles.join(', ')} member`);
  }
  if (state.actions.length > 1) {
    parts.push(`${state.actions.length} listings`);
  } else if (bundles.length === 0 && state.actions[0]) {
    parts.push(state.actions[0].store.slice(0, 2).toUpperCase());
  }
  return parts.join(' · ');
}

/** "3 of 5", or "3 · ?" when the count isn't on record. */
export function countLabel(state: PullLineState): string {
  return state.units_to_pull === null
    ? `${state.pulled_qty} · ?`
    : `${state.pulled_qty} of ${state.units_to_pull}`;
}

export function shortDate(iso: string | null): string {
  return iso && iso.length >= 10 ? iso.slice(5, 10) : '';
}

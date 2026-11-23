import type { LocalStowEvent, StowServerState } from './types';

// Everything shown on the Stow screens is worked out from the event log, so a
// restart restores the open box and an undo needs no separate bookkeeping.

export type StowRow = {
  key: string;
  boxLabel: string;
  sku: string;
  kind: 'stow' | 'move';
  /** Can be null in rows from older data; a move now starts at 1. */
  units: number | null;
  /** Time of the latest scan. */
  at: string;
  method: 'scan' | 'manual';
  movedFrom: string | null;
  /** What an undo of this row points at. */
  lastEventId: string;
  /** Orders rows newest first. A quantity edit doesn't reorder them. */
  scanSeq: number;
  /** The move that took this row's units to another box, or the undo of the move that brought them here. */
  hiddenBy: string | null;
  /** Set when the row came from a range-label scan; its rows are shown as one group. */
  range: RangeRef | null;
};

export type RangeRef = {
  /** The scanned code (AAQ1122001~015). */
  code: string;
  /** One range scan: the code and the seq of its first event. */
  group: string;
  /** Events in that scan (stowed or moved SKUs; skipped ones have none). */
  count: number;
};

const RANGE_NOTE = /^range (\d+)\/(\d+)$/;

/** A range scan's events carry note "range i/n" and the raw code in scanned_value. */
export function rangeRef(e: { note: string | null; scanned_value: string | null; seq: number }): RangeRef | null {
  const m = e.note ? RANGE_NOTE.exec(e.note) : null;
  if (!m || !e.scanned_value) {
    return null;
  }
  return { code: e.scanned_value, group: `${e.scanned_value}#${e.seq - Number(m[1]) + 1}`, count: Number(m[2]) };
}

export type StowListItem =
  | { kind: 'single'; key: string; row: StowRow }
  | { kind: 'range'; key: string; code: string; rows: StowRow[]; moved: number; units: number; scanSeq: number };

/** A box's rows for the screen: each range scan's rows folded into one item, newest first. */
export function groupRows(rows: StowRow[]): StowListItem[] {
  const items: StowListItem[] = [];
  const groups = new Map<string, Extract<StowListItem, { kind: 'range' }>>();
  for (const row of rows) {
    if (!row.range) {
      items.push({ kind: 'single', key: row.key, row });
      continue;
    }
    let group = groups.get(row.range.group);
    if (!group) {
      group = { kind: 'range', key: row.range.group, code: row.range.code, rows: [], moved: 0, units: 0, scanSeq: 0 };
      groups.set(row.range.group, group);
      items.push(group);
    }
    group.rows.push(row);
    group.moved += row.kind === 'move' ? 1 : 0;
    group.units += row.units ?? 0;
    group.scanSeq = Math.max(group.scanSeq, row.scanSeq);
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => a.sku.localeCompare(b.sku));
  }
  const seqOf = (item: StowListItem) => (item.kind === 'single' ? item.row.scanSeq : item.scanSeq);
  return items.sort((a, b) => seqOf(b) - seqOf(a));
}

export type StowBoxSummary = {
  label: string;
  units: number;
  /** Newest first. */
  rows: StowRow[];
};

export type StowSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** Printed label of the open box; null once finished. */
  openBox: string | null;
  /** Boxes holding at least one row, in the order they were first used. */
  boxes: StowBoxSummary[];
  skus: number;
  units: number;
  moves: number;
  rejects: number;
};

/** The session still in progress, from the newest event that has one. */
export function openSessionId(events: LocalStowEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const { session_id: id, action } = events[i].event;
    if (id) {
      return action === 'session_end' ? null : id;
    }
  }
  return null;
}

function buildSession(id: string, items: LocalStowEvent[]): StowSession {
  const rows: StowRow[] = [];
  let openBox: string | null = null;
  let endedAt: string | null = null;
  let moves = 0;
  let rejects = 0;

  const liveRow = (box: string | null, sku: string | null) =>
    rows.find((r) => r.kind === 'stow' && r.hiddenBy === null && r.boxLabel === box && r.sku === sku);

  for (const { event: e } of items) {
    switch (e.action) {
      case 'box_open':
        openBox = e.box_label;
        break;
      case 'session_end':
        endedAt = e.at;
        openBox = null;
        break;
      case 'stow': {
        if (!e.box_label || !e.sku) {
          break;
        }
        if (e.moved_from_box) {
          // The units left the old box, so its rows stop counting there.
          for (const row of rows) {
            if (row.hiddenBy === null && row.sku === e.sku && row.boxLabel === e.moved_from_box) {
              row.hiddenBy = e.event_id;
            }
          }
          moves += 1;
          rows.push({
            key: e.event_id,
            boxLabel: e.box_label,
            sku: e.sku,
            kind: 'move',
            // The count restarts at 1 in the new box; each remaining unit is scanned.
            units: e.units ?? 1,
            at: e.at,
            method: e.method,
            movedFrom: e.moved_from_box,
            lastEventId: e.event_id,
            scanSeq: e.seq,
            hiddenBy: null,
            range: rangeRef(e),
          });
          break;
        }
        const row = liveRow(e.box_label, e.sku);
        if (row) {
          row.units = (row.units ?? 0) + (e.units ?? 1);
          row.at = e.at;
          row.lastEventId = e.event_id;
          row.scanSeq = e.seq;
        } else {
          rows.push({
            key: e.event_id,
            boxLabel: e.box_label,
            sku: e.sku,
            kind: 'stow',
            units: e.units ?? 1,
            at: e.at,
            method: e.method,
            movedFrom: null,
            lastEventId: e.event_id,
            scanSeq: e.seq,
            hiddenBy: null,
            range: rangeRef(e),
          });
        }
        break;
      }
      case 'adjust': {
        const row = liveRow(e.box_label, e.sku);
        if (row) {
          row.units = (row.units ?? 0) + (e.units ?? 0);
          row.lastEventId = e.event_id;
        }
        break;
      }
      case 'undo': {
        const index = rows.findIndex((r) => r.hiddenBy === null && r.lastEventId === e.undoes_event_id);
        if (index >= 0) {
          const [row] = rows.splice(index, 1);
          if (row.kind === 'move') {
            moves -= 1;
            for (const other of rows) {
              if (other.hiddenBy === row.lastEventId) {
                other.hiddenBy = null;
              } else if (
                // Units scanned into the new box after the move go back with it,
                // as the server restores the old count.
                other.hiddenBy === null &&
                other.kind === 'stow' &&
                other.sku === row.sku &&
                other.boxLabel === row.boxLabel &&
                other.scanSeq > row.scanSeq
              ) {
                other.hiddenBy = e.event_id;
              }
            }
          }
        }
        break;
      }
      case 'reject':
        rejects += 1;
        break;
      case 'move_declined':
        break;
    }
  }

  const live = rows.filter((r) => r.hiddenBy === null);
  const boxes: StowBoxSummary[] = [];
  for (const row of live) {
    let box = boxes.find((b) => b.label === row.boxLabel);
    if (!box) {
      box = { label: row.boxLabel, units: 0, rows: [] };
      boxes.push(box);
    }
    box.units += row.units ?? 0;
    box.rows.push(row);
  }
  for (const box of boxes) {
    box.rows.sort((a, b) => b.scanSeq - a.scanSeq);
  }

  return {
    id,
    startedAt: items[0].event.at,
    endedAt,
    openBox,
    boxes,
    skus: new Set(live.map((r) => r.sku)).size,
    units: boxes.reduce((n, b) => n + b.units, 0),
    moves,
    rejects,
  };
}

/** Every session on this phone, newest first. */
export function deriveSessions(events: LocalStowEvent[]): StowSession[] {
  const grouped = new Map<string, LocalStowEvent[]>();
  for (const local of events) {
    const id = local.event.session_id;
    if (id) {
      grouped.set(id, [...(grouped.get(id) ?? []), local]);
    }
  }
  return [...grouped].map(([id, items]) => buildSession(id, items)).reverse();
}

export type StowLocation = {
  box: string;
  units: number | null;
  /** The box it was in before its last move, for moving it back. */
  previous: string | null;
};

/**
 * Events the server hasn't counted in its last state: still queued, or accepted
 * after that state was fetched. Sending is paused during a fetch.
 */
function isUnreflected(local: LocalStowEvent, fetchStartedAt: number | null): boolean {
  return local.acceptedAt === null || fetchStartedAt === null || local.acceptedAt > fetchStartedAt;
}

function subtract(map: Map<string, StowLocation>, sku: string, units: number) {
  const current = map.get(sku);
  if (!current || current.units === null) {
    return;
  }
  const left = current.units - units;
  if (left > 0) {
    map.set(sku, { ...current, units: left });
  } else {
    map.delete(sku);
  }
}

function applyLocation(
  map: Map<string, StowLocation>,
  { event: e }: LocalStowEvent,
  byId: Map<string, LocalStowEvent>,
  /** Each move's previous box before it happened, so undoing the move can restore it. */
  previousBefore: Map<string, string | null>
) {
  if (!e.sku) {
    return;
  }
  const current = map.get(e.sku);
  switch (e.action) {
    case 'stow':
      if (!e.box_label) {
        return;
      }
      if (e.moved_from_box) {
        previousBefore.set(e.event_id, current?.previous ?? null);
        map.set(e.sku, {
          box: e.box_label,
          // The count restarts at 1 in the new box; each remaining unit is scanned.
          units: e.units ?? 1,
          previous: e.moved_from_box === e.box_label ? (current?.previous ?? null) : e.moved_from_box,
        });
      } else if (current) {
        // Same box, or a box the phone didn't know about: the SKU stays in one box.
        // As on the server, a stow onto an unknown count sets it, and a stow into
        // another box is a move whose count starts at the stowed units.
        const same = current.box === e.box_label;
        map.set(e.sku, {
          box: e.box_label,
          units: !same || current.units === null ? (e.units ?? 1) : current.units + (e.units ?? 1),
          previous: same ? current.previous : current.box,
        });
      } else {
        map.set(e.sku, { box: e.box_label, units: e.units ?? 1, previous: null });
      }
      return;
    case 'adjust': {
      if (current && current.units !== null) {
        const next = current.units + (e.units ?? 0);
        if (next > 0) {
          map.set(e.sku, { ...current, units: next });
        } else {
          map.delete(e.sku);
        }
      }
      return;
    }
    case 'undo': {
      const local = e.undoes_event_id ? byId.get(e.undoes_event_id) : undefined;
      const undone = local?.event;
      if (undone?.action === 'stow' && undone.moved_from_box) {
        // Back with the count it had in the old box (null: unknown), which also
        // takes back units scanned in after the move. A move the server already
        // counted isn't replayed here, so its earlier previous box is unknown
        // until the next refresh.
        map.set(e.sku, {
          box: undone.moved_from_box,
          units: local?.movedUnits ?? null,
          previous: previousBefore.get(undone.event_id) ?? null,
        });
      } else {
        subtract(map, e.sku, e.units ?? 0);
      }
      return;
    }
    default:
      return;
  }
}

/** Where each SKU is now: the server's last state with this phone's newer events applied. */
export function deriveLocations(
  state: StowServerState | null,
  events: LocalStowEvent[],
  fetchStartedAt: number | null
): Map<string, StowLocation> {
  const map = new Map<string, StowLocation>();
  for (const location of state?.locations ?? []) {
    map.set(location.sku.toUpperCase(), {
      box: location.box_label,
      units: location.units,
      previous: location.previous_box ?? null,
    });
  }
  const byId = new Map(events.map((local) => [local.event.event_id, local]));
  const previousBefore = new Map<string, string | null>();
  for (const local of events) {
    if (isUnreflected(local, fetchStartedAt)) {
      applyLocation(map, local, byId, previousBefore);
    }
  }
  return map;
}

/** Null until the server's boxes have loaded at least once, when new can't be told from existing. */
export function isExistingBox(
  label: string,
  state: StowServerState | null,
  events: LocalStowEvent[],
  sessionId: string | null
): boolean | null {
  if (!state) {
    return null;
  }
  return (
    state.boxes.some((box) => box.label === label) ||
    events.some(
      (e) => e.event.action === 'stow' && e.event.box_label === label && e.event.session_id !== sessionId
    )
  );
}

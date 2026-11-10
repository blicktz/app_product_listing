import type { LocalStowEvent, StowEvent, StowServerState } from './types';

// Everything shown on the Stow screens is worked out from the event log, so a
// restart restores the open box and an undo needs no separate bookkeeping.

export type StowRow = {
  key: string;
  boxLabel: string;
  sku: string;
  kind: 'stow' | 'move';
  /** null: a move whose unit count isn't known. */
  units: number | null;
  /** Time of the latest scan. */
  at: string;
  method: 'scan' | 'manual';
  movedFrom: string | null;
  /** What an undo of this row points at. */
  lastEventId: string;
  /** Orders rows newest first. A quantity edit doesn't reorder them. */
  scanSeq: number;
  /** The move that took this row's units to another box. */
  hiddenBy: string | null;
};

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

  for (const { event: e, movedUnits } of items) {
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
            units: movedUnits ?? null,
            at: e.at,
            method: e.method,
            movedFrom: e.moved_from_box,
            lastEventId: e.event_id,
            scanSeq: e.seq,
            hiddenBy: null,
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

export type StowLocation = { box: string; units: number | null };

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
  { event: e, movedUnits }: LocalStowEvent,
  byId: Map<string, StowEvent>
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
        map.set(e.sku, { box: e.box_label, units: current?.units ?? movedUnits ?? null });
      } else if (current) {
        // Same box, or a box the phone didn't know about: the SKU stays in one box.
        map.set(e.sku, {
          box: e.box_label,
          units: current.units === null ? null : current.units + (e.units ?? 1),
        });
      } else {
        map.set(e.sku, { box: e.box_label, units: e.units ?? 1 });
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
      const undone = e.undoes_event_id ? byId.get(e.undoes_event_id) : undefined;
      if (undone?.action === 'stow' && undone.moved_from_box) {
        map.set(e.sku, { box: undone.moved_from_box, units: current?.units ?? null });
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
    map.set(location.sku.toUpperCase(), { box: location.box_label, units: location.units });
  }
  const byId = new Map(events.map((local) => [local.event.event_id, local.event]));
  for (const local of events) {
    if (isUnreflected(local, fetchStartedAt)) {
      applyLocation(map, local, byId);
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

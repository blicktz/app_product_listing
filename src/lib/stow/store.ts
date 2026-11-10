import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { getSnapshot as getPickSnapshot } from '../pick/store';
import { fetchStowState, postStowEvents } from './api';
import { deriveLocations, deriveSessions, openSessionId, type StowLocation, type StowSession } from './derive';
import type { LocalStowEvent, StowAction, StowEvent, StowServerState } from './types';

// Stow state, kept on disk under Documents/stow/ like Pick's, so a stow is never
// lost to a crash, a force-quit or a dead Wi-Fi spot in the garage:
//
//   stow/state.json    last GET /stow-state from the Mac
//   stow/events.json   stow events made on this phone (queued or accepted)
//   stow/meta.json     this install's ID and next sequence number
//
// The Mac's address and connection status are shared with Pick (pick/store.ts).

type PersistedState = {
  server: StowServerState | null;
  /** When the state's request started (ms); events accepted before it are in the state. */
  fetchStartedAt: number | null;
  loadedAt: string | null;
};

type Meta = { installId: string; nextSeq: number };

export type StowSnapshot = PersistedState & {
  events: LocalStowEvent[];
  refreshing: boolean;
  refreshError: string | null;
  sendError: string | null;
  unsentCount: number;
};

const ROOT = new Directory(Paths.document, 'stow');
const STATE_FILE = new File(ROOT, 'state.json');
const EVENTS_FILE = new File(ROOT, 'events.json');
const META_FILE = new File(ROOT, 'meta.json');

const SEND_DELAY_MS = 500;
const RETRY_INTERVAL_MS = 30_000;
const SEND_BATCH = 200;
// Accepted events of finished sessions are kept for the Recent sessions list.
const KEEP_FINISHED_MS = 30 * 24 * 3600 * 1000;

const DEVICE = `${Constants.deviceName ?? 'iPhone'} / app ${Constants.expoConfig?.version ?? '?'}`;

let state: PersistedState = { server: null, fetchStartedAt: null, loadedAt: null };
let events: LocalStowEvent[] = [];
let meta: Meta = { installId: '', nextSeq: 1 };
let refreshing = false;
let refreshError: string | null = null;
let sendError: string | null = null;
let sending = false;
let started = false;
let sendTimer: ReturnType<typeof setTimeout> | null = null;

let snapshot: StowSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

function buildSnapshot(): StowSnapshot {
  return {
    ...state,
    events,
    refreshing,
    refreshError,
    sendError,
    unsentCount: events.filter((e) => e.acceptedAt === null).length,
  };
}

function notify() {
  snapshot = buildSnapshot();
  for (const listener of listeners) {
    listener();
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): StowSnapshot {
  return snapshot;
}

// --- Disk ------------------------------------------------------------------

function writeJson(file: File, value: unknown) {
  ROOT.create({ intermediates: true, idempotent: true });
  const tmp = new File(ROOT, `${file.name}.tmp`);
  if (tmp.exists) {
    tmp.delete();
  }
  tmp.create();
  tmp.write(JSON.stringify(value));
  tmp.moveSync(file, { overwrite: true });
}

function readJson<T>(file: File): T | null {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as T) : null;
  } catch (error) {
    console.warn(`Could not read ${file.name}:`, error);
    return null;
  }
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// --- Lifecycle ---------------------------------------------------------------

export function startStowStore() {
  if (started) {
    return;
  }
  started = true;
  state = { ...state, ...(readJson<PersistedState>(STATE_FILE) ?? {}) };
  events = readJson<LocalStowEvent[]>(EVENTS_FILE) ?? [];

  const savedMeta = readJson<Meta>(META_FILE);
  const newestSeq = events.reduce((max, e) => Math.max(max, e.event.seq), 0);
  // A crash between the two writes must never reuse a sequence number.
  meta = {
    installId: savedMeta?.installId ?? uuid(),
    nextSeq: Math.max(savedMeta?.nextSeq ?? 1, newestSeq + 1),
  };
  writeJson(META_FILE, meta);
  notify();

  AppState.addEventListener('change', (appState) => {
    if (appState === 'active') {
      void flushEvents();
    }
  });
  setInterval(() => void flushEvents(), RETRY_INTERVAL_MS);
  void refreshStowState();
}

// --- Events ----------------------------------------------------------------

export type StowRecordInput = {
  action: StowAction;
  boxLabel?: string | null;
  sku?: string | null;
  units?: number | null;
  movedFromBox?: string | null;
  undoesEventId?: string | null;
  method?: 'scan' | 'manual';
  scannedValue?: string | null;
  note?: string | null;
  movedUnits?: number | null;
};

export function recordStowEvent(input: StowRecordInput): StowEvent {
  // The first box scanned starts a session.
  const sessionId = openSessionId(events) ?? (input.action === 'box_open' ? uuid() : null);
  const event: StowEvent = {
    event_id: uuid(),
    session_id: sessionId,
    seq: meta.nextSeq,
    action: input.action,
    box_label: input.boxLabel ?? null,
    sku: input.sku ?? null,
    units: input.units ?? null,
    moved_from_box: input.movedFromBox ?? null,
    undoes_event_id: input.undoesEventId ?? null,
    method: input.method ?? 'scan',
    scanned_value: input.scannedValue ?? null,
    note: input.note ?? null,
    at: new Date().toISOString(),
  };
  const local: LocalStowEvent = { event, acceptedAt: null };
  if (input.movedUnits !== undefined) {
    local.movedUnits = input.movedUnits;
  }
  events = [...events, local];
  meta = { ...meta, nextSeq: meta.nextSeq + 1 };
  writeJson(EVENTS_FILE, events);
  writeJson(META_FILE, meta);
  notify();
  scheduleSend();
  return event;
}

function scheduleSend() {
  if (sendTimer) {
    clearTimeout(sendTimer);
  }
  sendTimer = setTimeout(() => {
    sendTimer = null;
    void flushEvents();
  }, SEND_DELAY_MS);
}

export async function flushEvents(): Promise<void> {
  // Never send during a fetch: its start time decides which events it already counts.
  if (sending || refreshing) {
    return;
  }
  sending = true;
  try {
    for (;;) {
      const batch = events.filter((e) => e.acceptedAt === null).slice(0, SEND_BATCH);
      if (batch.length === 0) {
        break;
      }
      const { accepted } = await postStowEvents(
        getPickSnapshot().serverUrl,
        DEVICE,
        meta.installId,
        batch.map((e) => e.event)
      );
      const acceptedIds = new Set(accepted);
      const now = Date.now();
      events = events.map((e) =>
        e.acceptedAt === null && acceptedIds.has(e.event.event_id) ? { ...e, acceptedAt: now } : e
      );
      writeJson(EVENTS_FILE, events);
      sendError = null;
      notify();
      if (acceptedIds.size === 0) {
        break;
      }
    }
  } catch (error) {
    console.warn('Sending stow events failed:', error);
    sendError = error instanceof Error ? error.message : String(error);
    notify();
  } finally {
    sending = false;
  }
}

// --- Refresh -----------------------------------------------------------------

/** Drops old finished sessions, once the Mac has every one of their events. */
function pruneEvents() {
  const cutoff = Date.now() - KEEP_FINISHED_MS;
  const openId = openSessionId(events);
  const blocked = new Set<string | null>(openId ? [openId] : []);
  for (const { event, acceptedAt } of events) {
    if (acceptedAt === null || acceptedAt > cutoff) {
      blocked.add(event.session_id);
    }
  }
  events = events.filter((e) => blocked.has(e.event.session_id));
}

export async function refreshStowState(): Promise<void> {
  if (refreshing) {
    return;
  }
  // Hand the Mac everything first, so the state it returns already counts it.
  await flushEvents();
  while (sending) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  refreshing = true;
  refreshError = null;
  notify();

  const fetchStartedAt = Date.now();
  try {
    const server = await fetchStowState(getPickSnapshot().serverUrl);
    state = { server, fetchStartedAt, loadedAt: new Date().toISOString() };
    writeJson(STATE_FILE, state);
    pruneEvents();
    writeJson(EVENTS_FILE, events);
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error);
  } finally {
    refreshing = false;
    notify();
    scheduleSend();
  }
}

// --- Reads for the scan handler, which runs outside render ----------------------

export function currentSession(): StowSession | null {
  const id = openSessionId(events);
  return id ? (deriveSessions(events).find((s) => s.id === id) ?? null) : null;
}

export function currentLocations(): Map<string, StowLocation> {
  return deriveLocations(state.server, events, state.fetchStartedAt);
}

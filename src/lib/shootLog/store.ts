import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { getSnapshot as getPickSnapshot } from '../pick/store';
import { fetchShootState, postShootEvents } from './api';
import type { ShootAction, ShootEvent, ShootEventDetails, ShootSessionSummary } from './types';

// The log of what was shot, sent to the Mac for review and trace-back. Kept on
// disk under Documents/shoot/, separate from the upload job folders so it
// outlives them:
//
//   shoot/events.json  events the Mac hasn't accepted yet
//   shoot/meta.json    this install's ID and next sequence number
//   shoot/state.json   last GET /shoot-state, for the Recent sessions list
//
// Logging must never get in the way of shooting or uploading, so a failure here
// is only ever remembered and retried.

type Meta = { installId: string; nextSeq: number };

type PersistedState = {
  sessions: ShootSessionSummary[];
  loadedAt: string | null;
};

export type ShootLogSnapshot = PersistedState & {
  refreshing: boolean;
  unsentCount: number;
};

const ROOT = new Directory(Paths.document, 'shoot');
const EVENTS_FILE = new File(ROOT, 'events.json');
const META_FILE = new File(ROOT, 'meta.json');
const STATE_FILE = new File(ROOT, 'state.json');

const SEND_DELAY_MS = 500;
const RETRY_INTERVAL_MS = 30_000;
const SEND_BATCH = 200;

const DEVICE = Constants.deviceName ?? 'iPhone';
const APP_VERSION = Constants.expoConfig?.version ?? null;

let state: PersistedState = { sessions: [], loadedAt: null };
let events: ShootEvent[] = [];
let meta: Meta = { installId: '', nextSeq: 1 };
let refreshing = false;
let sending = false;
let started = false;
let sendTimer: ReturnType<typeof setTimeout> | null = null;

let snapshot: ShootLogSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

function buildSnapshot(): ShootLogSnapshot {
  return { ...state, refreshing, unsentCount: events.length };
}

function notify() {
  snapshot = buildSnapshot();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useShootLog(): ShootLogSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

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

export function startShootLog() {
  if (started) {
    return;
  }
  started = true;
  state = { ...state, ...(readJson<PersistedState>(STATE_FILE) ?? {}) };
  events = readJson<ShootEvent[]>(EVENTS_FILE) ?? [];

  const savedMeta = readJson<Meta>(META_FILE);
  const newestSeq = events.reduce((max, e) => Math.max(max, e.seq), 0);
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
  void flushEvents();
}

export type ShootEventInput = ShootEventDetails & {
  action: ShootAction;
  sessionId: string;
  dateRoot: string;
  sku: string;
};

export function logShootEvent({ action, sessionId, dateRoot, sku, ...details }: ShootEventInput) {
  try {
    const event: ShootEvent = {
      ...details,
      event_id: uuid(),
      session_id: sessionId,
      seq: meta.nextSeq,
      action,
      date_root: dateRoot,
      sku,
      at: new Date().toISOString(),
    };
    events = [...events, event];
    meta = { ...meta, nextSeq: meta.nextSeq + 1 };
    writeJson(EVENTS_FILE, events);
    writeJson(META_FILE, meta);
    notify();
    scheduleSend();
  } catch (error) {
    console.warn('Could not record shoot event:', error);
  }
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

async function flushEvents(): Promise<void> {
  if (sending) {
    return;
  }
  sending = true;
  try {
    for (;;) {
      const batch = events.slice(0, SEND_BATCH);
      if (batch.length === 0) {
        break;
      }
      const { accepted } = await postShootEvents(
        getPickSnapshot().serverUrl,
        DEVICE,
        meta.installId,
        APP_VERSION,
        batch
      );
      const acceptedIds = new Set(accepted);
      events = events.filter((e) => !acceptedIds.has(e.event_id));
      writeJson(EVENTS_FILE, events);
      notify();
      if (acceptedIds.size === 0) {
        break;
      }
    }
  } catch {
    // Mac not reachable: the events stay on disk for the next attempt.
  } finally {
    sending = false;
  }
}

export async function refreshShootState(): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  notify();
  try {
    await flushEvents();
    const server = await fetchShootState(getPickSnapshot().serverUrl);
    state = { sessions: server.sessions, loadedAt: new Date().toISOString() };
    writeJson(STATE_FILE, state);
  } catch {
    // Keep showing the last list.
  } finally {
    refreshing = false;
    notify();
  }
}

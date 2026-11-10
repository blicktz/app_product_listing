import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { DEFAULT_SERVER_URL, checkHealth, fetchPickList, postPickEvents } from './api';
import { deriveLineStates, isDone, type LineState, type LocalEvent } from './derive';
import { cleanupImages, prefetchImages } from './images';
import type { PickAction, PickEvent, PickLine, PickList } from './types';

// Picking state, kept on disk under Documents/pick/ so a pick is never lost to
// a crash, a force-quit or a dead Wi-Fi spot in the garage:
//
//   pick/state.json     last pick list from the Mac + lines whose order vanished
//   pick/events.json    every pick event made on this phone (queued or accepted)
//   pick/settings.json  Mac server URL override
//
// Events are written to disk before anything else happens, then sent to the Mac
// in the background and retried until it accepts them.

export type OrphanLine = {
  line: PickLine;
  pickedQty: number;
  removedAt: string;
};

type PersistedState = {
  list: PickList | null;
  /** When the current list's request started (ms); events accepted before it are in the list. */
  fetchStartedAt: number | null;
  loadedAt: string | null;
  /** Picked lines that dropped off a later list: order cancelled or already shipped. */
  orphans: OrphanLine[];
};

export type PickSnapshot = PersistedState & {
  events: LocalEvent[];
  serverUrl: string;
  /** null until the first request this run. */
  online: boolean | null;
  refreshing: 'full' | 'quick' | null;
  refreshError: string | null;
  unsentCount: number;
};

const ROOT = new Directory(Paths.document, 'pick');
const STATE_FILE = new File(ROOT, 'state.json');
const EVENTS_FILE = new File(ROOT, 'events.json');
const SETTINGS_FILE = new File(ROOT, 'settings.json');

const SEND_DELAY_MS = 500;
const RETRY_INTERVAL_MS = 30_000;
const SEND_BATCH = 200;
// Accepted events are only kept for the "picked at" times on screen.
const KEEP_ACCEPTED_MS = 3 * 24 * 3600 * 1000;

const DEVICE = `${Constants.deviceName ?? 'iPhone'} / app ${Constants.expoConfig?.version ?? '?'}`;

let state: PersistedState = { list: null, fetchStartedAt: null, loadedAt: null, orphans: [] };
let events: LocalEvent[] = [];
let serverUrl = DEFAULT_SERVER_URL;
let online: boolean | null = null;
let refreshing: PickSnapshot['refreshing'] = null;
let refreshError: string | null = null;
let sending = false;
let started = false;
let sendTimer: ReturnType<typeof setTimeout> | null = null;

let snapshot: PickSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

function buildSnapshot(): PickSnapshot {
  return {
    ...state,
    events,
    serverUrl,
    online,
    refreshing,
    refreshError,
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

export function getSnapshot(): PickSnapshot {
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

function saveState() {
  writeJson(STATE_FILE, state);
}

function saveEvents() {
  writeJson(EVENTS_FILE, events);
}

// --- Lifecycle ---------------------------------------------------------------

export function startPickStore() {
  if (started) {
    return;
  }
  started = true;
  state = { ...state, ...(readJson<PersistedState>(STATE_FILE) ?? {}) };
  events = readJson<LocalEvent[]>(EVENTS_FILE) ?? [];
  const settings = readJson<{ serverUrl?: string }>(SETTINGS_FILE);
  if (settings?.serverUrl) {
    serverUrl = settings.serverUrl;
  }
  notify();

  AppState.addEventListener('change', (appState) => {
    if (appState === 'active') {
      void tick();
    }
  });
  setInterval(() => void tick(), RETRY_INTERVAL_MS);
  void tick();
}

/** Periodic: send what's queued, or just check the Mac is there. */
async function tick() {
  if (events.some((e) => e.acceptedAt === null)) {
    await flushEvents();
  } else if (!refreshing) {
    setOnline(await checkHealth(serverUrl));
  }
}

function setOnline(value: boolean) {
  if (online !== value) {
    online = value;
    notify();
  }
}

export function setServerUrl(url: string) {
  serverUrl = url.trim();
  writeJson(SETTINGS_FILE, { serverUrl });
  online = null;
  notify();
  void tick();
}

// --- Events ----------------------------------------------------------------

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type RecordInput = {
  action: PickAction;
  line?: PickLine | null;
  /** Box that was open when it happened (null: no box open / unlocated). */
  boxId: string | null;
  method?: 'scan' | 'manual';
  scannedValue?: string | null;
  note?: string | null;
};

export function recordEvent(input: RecordInput): PickEvent {
  const event: PickEvent = {
    event_id: uuid(),
    snapshot_id: state.list?.snapshot_id ?? null,
    line_key: input.line?.line_key ?? null,
    order_id: input.line?.order_id ?? null,
    sku: input.line?.sku ?? null,
    expected_box_id: input.line?.box_id ?? null,
    box_id: input.boxId,
    action: input.action,
    method: input.method ?? 'scan',
    scanned_value: input.scannedValue ?? null,
    note: input.note ?? null,
    at: new Date().toISOString(),
  };
  events = [...events, { event, acceptedAt: null }];
  saveEvents();
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
  // Never send during a fetch: the list's fetch time decides which events it
  // already counts (see derive.ts).
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
      const { accepted } = await postPickEvents(
        serverUrl,
        DEVICE,
        batch.map((e) => e.event)
      );
      const acceptedIds = new Set(accepted);
      const now = Date.now();
      events = events.map((e) =>
        e.acceptedAt === null && acceptedIds.has(e.event.event_id) ? { ...e, acceptedAt: now } : e
      );
      saveEvents();
      setOnline(true);
      notify();
      if (acceptedIds.size === 0) {
        break;
      }
    }
  } catch (error) {
    console.warn('Sending pick events failed:', error);
    setOnline(false);
  } finally {
    sending = false;
  }
}

// --- Refresh -----------------------------------------------------------------

export function currentLineStates(): Map<string, LineState> {
  return deriveLineStates(state.list?.lines ?? [], events, state.fetchStartedAt);
}

export async function refreshPickList(resync: boolean): Promise<void> {
  if (refreshing) {
    return;
  }
  // Hand the Mac everything first, so the list it returns already counts it.
  await flushEvents();
  while (sending) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  refreshing = resync ? 'full' : 'quick';
  refreshError = null;
  notify();

  const before = currentLineStates();
  const fetchStartedAt = Date.now();
  try {
    const list = await fetchPickList(serverUrl, resync);
    const newKeys = new Set(list.lines.map((line) => line.line_key));

    const orphans = state.orphans.filter((o) => !newKeys.has(o.line.line_key));
    const known = new Set(orphans.map((o) => o.line.line_key));
    for (const prior of before.values()) {
      if (prior.pickedQty > 0 && !newKeys.has(prior.line.line_key) && !known.has(prior.line.line_key)) {
        orphans.push({
          line: prior.line,
          pickedQty: prior.pickedQty,
          removedAt: new Date().toISOString(),
        });
      }
    }

    state = { list, fetchStartedAt, loadedAt: new Date().toISOString(), orphans };
    saveState();

    const cutoff = Date.now() - KEEP_ACCEPTED_MS;
    events = events.filter((e) => e.acceptedAt === null || e.acceptedAt > cutoff);
    saveEvents();

    online = true;
    const openLines = [...currentLineStates().values()].filter((s) => !isDone(s)).map((s) => s.line);
    void prefetchImages(openLines);
    cleanupImages(list.lines);
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error);
    online = false;
  } finally {
    refreshing = null;
    notify();
    scheduleSend();
  }
}

export function dismissOrphan(lineKey: string) {
  state = { ...state, orphans: state.orphans.filter((o) => o.line.line_key !== lineKey) };
  saveState();
  notify();
}

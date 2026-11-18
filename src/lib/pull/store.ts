import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { MacServerError } from '../pick/api';
import { getSnapshot as getPickSnapshot } from '../pick/store';
import { OrdersNotSyncedError, fetchHealth, fetchPullList, postPullEvent } from './api';
import { deriveLines, type PullLineState } from './derive';
import { cleanupImages, prefetchImages } from './images';
import type {
  OrdersSync,
  PullEvent,
  PullEventAction,
  PullEventReply,
  PullLineUpdate,
  PullList,
} from './types';

// Pull state, kept under Documents/pull/. Separate from Pick's on purpose.
//
// Pull is ONLY online (requirements §5.3): a pull, finish, missing or undo
// counts only once the Mac has accepted it, one event per request. So unlike
// Pick there is no event queue. What's on disk:
//
//   pull/state.json    last pull list + the server's line answers since (view only)
//   pull/pending.json  the one event sent but not yet answered, so a crash or a
//                      lost reply retries the SAME event ID (safe: it's the
//                      idempotency key) instead of guessing whether it counted
//   pull/rejects.json  scans the phone refused itself; recorded on the Mac,
//                      sent in the background (they take nothing off the shelf)
//
// The Mac's address is Pick's (pick/store.ts), like Stow and Pack.

type UndoEntry = { action: Exclude<PullEventAction, 'undo' | 'reject'>; at: string };

type PersistedState = {
  list: PullList | null;
  loadedAt: string | null;
  /** The server's latest answer per line since the list was loaded. */
  updates: Record<string, PullLineUpdate>;
  /** This phone's accepted pull/finish/missing per line, newest last, to name what an undo reverses. */
  undoStack: Record<string, UndoEntry[]>;
};

export type PendingEvent = {
  event: PullEvent;
  /** A send failed (no answer); it's retried with the same ID. */
  failed: boolean;
};

/** Why pulling is off, if it is. */
export type PullBlock = 'offline' | 'orders_not_synced' | 'orders_syncing' | 'no_list' | null;

export type PullSnapshot = PersistedState & {
  pending: PendingEvent | null;
  online: boolean | null;
  ordersSync: OrdersSync | null;
  /** The last list load was refused because orders weren't synced. */
  listRefused: boolean;
  refreshing: boolean;
  refreshError: string | null;
  serverUrl: string;
};

const ROOT = new Directory(Paths.document, 'pull');
const STATE_FILE = new File(ROOT, 'state.json');
const PENDING_FILE = new File(ROOT, 'pending.json');
const REJECTS_FILE = new File(ROOT, 'rejects.json');

const HEALTH_INTERVAL_MS = 30_000;

const DEVICE = `${Constants.deviceName ?? 'iPhone'} / app ${Constants.expoConfig?.version ?? '?'}`;

let state: PersistedState = { list: null, loadedAt: null, updates: {}, undoStack: {} };
let pending: PendingEvent | null = null;
let rejects: PullEvent[] = [];
let online: boolean | null = null;
let ordersSync: OrdersSync | null = null;
let listRefused = false;
let refreshing = false;
let refreshError: string | null = null;
let sending = false;
let sendingRejects = false;
let started = false;

let snapshot: PullSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

function serverUrl(): string {
  return getPickSnapshot().serverUrl;
}

function buildSnapshot(): PullSnapshot {
  return {
    ...state,
    pending,
    online,
    ordersSync,
    listRefused,
    refreshing,
    refreshError,
    serverUrl: serverUrl(),
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

export function getSnapshot(): PullSnapshot {
  return snapshot;
}

/** Why pulling is off right now, or null when the Mac will take a pull. */
export function pullBlock(snap: PullSnapshot = snapshot): PullBlock {
  if (!snap.list) {
    return 'no_list';
  }
  if (snap.online === false) {
    return 'offline';
  }
  if (snap.listRefused) {
    return 'orders_not_synced';
  }
  // Strict: pulling needs the Mac to say its latest order sync is OK (§5.6).
  if (!snap.ordersSync) {
    return snap.online === null ? 'offline' : 'orders_not_synced';
  }
  if (!snap.ordersSync.ok) {
    return snap.ordersSync.state === 'running' ? 'orders_syncing' : 'orders_not_synced';
  }
  return null;
}

// --- Disk --------------------------------------------------------------------

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

function savePending() {
  writeJson(PENDING_FILE, pending);
}

function saveRejects() {
  writeJson(REJECTS_FILE, rejects);
}

// --- Lifecycle ---------------------------------------------------------------

export function startPullStore() {
  if (started) {
    return;
  }
  started = true;
  state = { ...state, ...(readJson<PersistedState>(STATE_FILE) ?? {}) };
  state.updates ??= {};
  state.undoStack ??= {};
  pending = readJson<PendingEvent | null>(PENDING_FILE);
  if (pending) {
    pending = { ...pending, failed: true };
  }
  rejects = readJson<PullEvent[]>(REJECTS_FILE) ?? [];
  notify();

  AppState.addEventListener('change', (appState) => {
    if (appState === 'active') {
      void tick();
    }
  });
  setInterval(() => {
    if (AppState.currentState === 'active') {
      void tick();
    }
  }, HEALTH_INTERVAL_MS);
  void tick();
}

/** Periodic: Mac reachable? order sync OK? Then retry what's left unsent. */
export async function tick() {
  if (refreshing) {
    return;
  }
  const health = await fetchHealth(serverUrl());
  online = health.ok;
  if (health.ok) {
    ordersSync = health.ordersSync;
    // A successful sync since the refused load lifts the block.
    if (listRefused && ordersSync?.ok) {
      listRefused = false;
    }
  }
  notify();
  if (health.ok) {
    if (pending) {
      await resendPending();
    }
    void flushRejects();
  }
}

// --- Events ------------------------------------------------------------------

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type EventInput = {
  action: PullEventAction;
  line?: PullLineState | null;
  /** Box that was open when it happened (null: none / unlocated). */
  boxId: string | null;
  method?: 'scan' | 'manual';
  scannedValue?: string | null;
  note?: string | null;
};

function buildEvent(input: EventInput): PullEvent {
  return {
    event_id: uuid(),
    snapshot_id: state.list?.snapshot_id ?? null,
    line_key: input.line?.line_key ?? null,
    sku: input.line?.sku ?? null,
    expected_box_id: input.line?.box_id ?? null,
    box_id: input.boxId,
    action: input.action,
    method: input.method ?? 'scan',
    scanned_value: input.scannedValue ?? null,
    note: input.note ?? null,
    at: new Date().toISOString(),
  };
}

export type SendResult =
  | { kind: 'reply'; reply: PullEventReply; event: PullEvent }
  /** No answer from the Mac; the event stays pending and is retried with the same ID. */
  | { kind: 'no-answer'; event: PullEvent }
  /** Another event is still waiting for its answer. */
  | { kind: 'busy' }
  /** The Mac refused the request itself (HTTP 4xx): dropped, never counted. */
  | { kind: 'refused'; message: string };

function applyReply(event: PullEvent, reply: PullEventReply) {
  const updates = { ...state.updates };
  if (reply.line) {
    updates[reply.line.line_key] = reply.line;
  }
  const undoStack = { ...state.undoStack };
  if (reply.accepted && event.line_key) {
    const stack = [...(undoStack[event.line_key] ?? [])];
    if (event.action === 'undo') {
      stack.pop();
    } else if (event.action !== 'reject') {
      stack.push({ action: event.action, at: event.at });
    }
    undoStack[event.line_key] = stack;
  }
  state = { ...state, updates, undoStack };
  saveState();

  if (reply.reason === 'orders_not_synced') {
    ordersSync = { ok: false, state: 'failed', at: ordersSync?.at ?? null };
  } else if (reply.accepted && !ordersSync?.ok) {
    // The Mac only accepts a pull while its sync is OK.
    ordersSync = { ok: true, state: 'ok', at: ordersSync?.at ?? null };
  }
}

async function deliver(event: PullEvent): Promise<SendResult> {
  sending = true;
  notify();
  try {
    const reply = await postPullEvent(serverUrl(), DEVICE, event);
    online = true;
    pending = null;
    savePending();
    applyReply(event, reply);
    return { kind: 'reply', reply, event };
  } catch (error) {
    if (error instanceof MacServerError && error.status >= 400 && error.status < 500 && error.status !== 408) {
      // Malformed or unauthorised: resending won't help.
      pending = null;
      savePending();
      return { kind: 'refused', message: error.message };
    }
    online = false;
    pending = { event, failed: true };
    savePending();
    return { kind: 'no-answer', event };
  } finally {
    sending = false;
    notify();
  }
}

/** Sends a pull, finish, missing or undo and waits for the Mac's answer. Only one at a time. */
export async function sendEvent(input: EventInput): Promise<SendResult> {
  if (pending || sending) {
    return { kind: 'busy' };
  }
  const event = buildEvent(input);
  pending = { event, failed: false };
  savePending();
  return deliver(event);
}

/** Retries the unanswered event with its own ID. */
export async function resendPending(): Promise<SendResult | null> {
  if (!pending || sending) {
    return null;
  }
  return deliver(pending.event);
}

/** A scan the phone refused itself: recorded on the Mac, never blocks scanning. */
export function recordReject(input: Omit<EventInput, 'action'>) {
  rejects = [...rejects, buildEvent({ ...input, action: 'reject' })];
  saveRejects();
  void flushRejects();
}

async function flushRejects() {
  if (sendingRejects || rejects.length === 0) {
    return;
  }
  sendingRejects = true;
  try {
    while (rejects.length > 0) {
      const event = rejects[0];
      try {
        await postPullEvent(serverUrl(), DEVICE, event);
      } catch (error) {
        if (!(error instanceof MacServerError && error.status >= 400 && error.status < 500)) {
          break; // try again on the next tick
        }
      }
      rejects = rejects.slice(1);
      saveRejects();
    }
  } finally {
    sendingRejects = false;
  }
}

// --- Refresh -----------------------------------------------------------------

export function currentLines(): Map<string, PullLineState> {
  return deriveLines(state.list?.lines ?? [], state.updates);
}

export async function refreshPullList(): Promise<void> {
  if (refreshing) {
    return;
  }
  // An unanswered event goes first, so the list that comes back counts it.
  if (pending) {
    const result = await resendPending();
    if (result?.kind === 'no-answer') {
      refreshError = 'The Mac didn’t answer. Try again.';
      notify();
      return;
    }
  }
  refreshing = true;
  refreshError = null;
  notify();
  try {
    const list = await fetchPullList(serverUrl());
    state = { list, loadedAt: new Date().toISOString(), updates: {}, undoStack: {} };
    saveState();
    online = true;
    listRefused = false;
    // Served only after a successful order sync (§5.2).
    ordersSync = { ok: true, state: 'ok', at: list.orders_synced_at ?? new Date().toISOString() };
    const open = [...currentLines().values()].filter((s) => !s.complete);
    void prefetchImages(open);
    cleanupImages(list.lines);
  } catch (error) {
    if (error instanceof OrdersNotSyncedError) {
      online = true;
      listRefused = true;
      ordersSync = { ok: false, state: 'failed', at: ordersSync?.at ?? null };
    } else {
      refreshError = error instanceof Error ? error.message : String(error);
      online = false;
    }
  } finally {
    refreshing = false;
    notify();
    void flushRejects();
  }
}

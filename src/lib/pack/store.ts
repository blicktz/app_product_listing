import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { createImageCache } from '../pick/images';
import { getSnapshot as getPickSnapshot } from '../pick/store';
import { DEFAULT_LOAD_HOURS, fetchPackState, postPackEvents } from './api';
import { deriveBoard, type Board } from './derive';
import type { RecordSpec } from './scan';
import type { LocalPackEvent, PackConflict, PackEvent, PackServerState } from './types';

// Packing state, kept on disk under Documents/pack/ like Pick's and Stow's, so
// a scan is never lost to a crash, a force-quit or a dead Wi-Fi spot:
//
//   pack/state.json    last GET /pack-state from the Mac
//   pack/events.json   pack events made on this phone (queued or accepted)
//   pack/meta.json     this install's ID and next sequence number
//
// The Mac's address and connection status are shared with Pick (pick/store.ts).
//
// The desktop Packing tab works on the same records at the same time
// (docs/pack-app/parallel-run.md), so while Pack is in front the state is
// re-read quietly every 30 s, and the Mac's `conflicts` (a scan of a package
// the desktop had already packed) come back to the packer as a notice.

type PersistedState = {
  server: PackServerState | null;
  /** When the state's request started (ms); events accepted before it are in the state. */
  fetchStartedAt: number | null;
  loadedAt: string | null;
};

type Meta = { installId: string; nextSeq: number };

/** Something the packer must see that didn't come from their own action. */
export type PackNotice = { id: number; title: string; detail?: string };

export type PackSnapshot = PersistedState & {
  events: LocalPackEvent[];
  board: Board;
  /** The package on the Package screen; null on Pack home. */
  openKey: string | null;
  /** Only refreshes the packer asked for; automatic reloads are silent. */
  refreshing: 'load' | 'quick' | null;
  refreshError: string | null;
  sendError: string | null;
  unsentCount: number;
  /** A Load labels is running on the Mac (from this phone or the desktop). */
  loadRunning: boolean;
  /** Hours of the last Load labels asked for on this phone (the Mac may have run another window). */
  requestedLoadHours: number | null;
  notices: PackNotice[];
};

const ROOT = new Directory(Paths.document, 'pack');
const STATE_FILE = new File(ROOT, 'state.json');
const EVENTS_FILE = new File(ROOT, 'events.json');
const META_FILE = new File(ROOT, 'meta.json');

const SEND_DELAY_MS = 500;
const RETRY_INTERVAL_MS = 30_000;
const SEND_BATCH = 200;
const KEEP_ACCEPTED_MS = 30 * 24 * 3600 * 1000;
/** Automatic quiet reload while a Pack screen is in front. */
const AUTO_RELOAD_MS = 30_000;
/** A screen coming to the front reloads unless the state is this fresh. */
const FOCUS_RELOAD_AFTER_MS = 5_000;
const LOAD_POLL_MS = 15_000;
/** Before Mark packed: reload if older than this, waiting at most FRESH_TIMEOUT_MS. */
const FRESH_MAX_AGE_MS = 30_000;
const FRESH_TIMEOUT_MS = 3_000;

const DEVICE = `${Constants.deviceName ?? 'iPhone'} / app ${Constants.expoConfig?.version ?? '?'}`;

export const packImages = createImageCache('pack-images');

let state: PersistedState = { server: null, fetchStartedAt: null, loadedAt: null };
let events: LocalPackEvent[] = [];
let meta: Meta = { installId: '', nextSeq: 1 };
let openKey: string | null = null;
let refreshing: PackSnapshot['refreshing'] = null;
let refreshError: string | null = null;
let sendError: string | null = null;
let requestedLoadHours: number | null = null;
let notices: PackNotice[] = [];
let nextNoticeId = 1;
/** A refresh (manual or quiet) is under way; only one at a time. */
let busy = false;
/** The state request is in flight: sending pauses (its start time decides what it counts). */
let fetching = false;
let sending = false;
let started = false;
let lastFetchAt = 0;
let focusCount = 0;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let autoTimer: ReturnType<typeof setInterval> | null = null;
let loadPollTimer: ReturnType<typeof setTimeout> | null = null;

let board: Board = deriveBoard([], [], null);
let snapshot: PackSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

function buildSnapshot(): PackSnapshot {
  return {
    ...state,
    events,
    board,
    openKey,
    refreshing,
    refreshError,
    sendError,
    unsentCount: events.filter((e) => e.acceptedAt === null).length,
    loadRunning: state.server?.load_running === true,
    requestedLoadHours,
    notices,
  };
}

/** boardChanged: the server state or the events changed, so the board is re-derived. */
function notify(boardChanged = false) {
  if (boardChanged) {
    board = deriveBoard(state.server?.packages ?? [], events, state.fetchStartedAt);
  }
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

export function getSnapshot(): PackSnapshot {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hhmm(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// --- Lifecycle ---------------------------------------------------------------

export function startPackStore() {
  if (started) {
    return;
  }
  started = true;
  state = { ...state, ...(readJson<PersistedState>(STATE_FILE) ?? {}) };
  events = readJson<LocalPackEvent[]>(EVENTS_FILE) ?? [];

  const savedMeta = readJson<Meta>(META_FILE);
  const newestSeq = events.reduce((max, e) => Math.max(max, e.event.seq), 0);
  // A crash between the two writes must never reuse a sequence number.
  meta = {
    installId: savedMeta?.installId ?? uuid(),
    nextSeq: Math.max(savedMeta?.nextSeq ?? 1, newestSeq + 1),
  };
  writeJson(META_FILE, meta);
  notify(true);

  AppState.addEventListener('change', (appState) => {
    if (appState === 'active') {
      if (focusCount > 0) {
        void quietReload();
      } else {
        void flushEvents();
      }
    }
  });
  setInterval(() => void flushEvents(), RETRY_INTERVAL_MS);
  void refreshPackState(false);
}

/** The Package screen sets this; Pack home clears it (no package open there). */
export function setOpenKey(key: string | null) {
  if (openKey !== key) {
    openKey = key;
    notify();
  }
}

/**
 * A Pack screen came to the front: reload quietly now (unless just done) and
 * every 30 s until no Pack screen is in front. Returns the matching blur.
 */
export function packScreenFocused(): () => void {
  focusCount += 1;
  if (Date.now() - lastFetchAt > FOCUS_RELOAD_AFTER_MS) {
    void quietReload();
  }
  if (!autoTimer) {
    autoTimer = setInterval(() => void quietReload(), AUTO_RELOAD_MS);
  }
  return () => {
    focusCount = Math.max(0, focusCount - 1);
    if (focusCount === 0 && autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  };
}

// --- Notices -------------------------------------------------------------------

function pushNotice(title: string, detail?: string) {
  notices = [...notices, { id: nextNoticeId++, title, detail }];
  notify();
}

/** The screen in front has shown it. */
export function consumeNotice(id: number) {
  notices = notices.filter((n) => n.id !== id);
  notify();
}

function packageName(key: string | null): string {
  if (!key) {
    return 'A package';
  }
  const pkg = board.byKey.get(key) ?? board.byKey.get(board.orderIndex.get(key) ?? '');
  return pkg?.pkg.name ?? key;
}

function whereFrom(source: string | null | undefined): string {
  return source === 'desktop' ? ' on the desktop' : source === 'phone' ? ' on another phone' : '';
}

function reportConflicts(conflicts: PackConflict[]) {
  // One notice per package: a batch can hold several scans of the same one.
  const seen = new Set<string>();
  for (const c of conflicts) {
    const key = c.package_key ?? c.event_id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pushNotice(
      `${packageName(c.package_key)} was already packed${whereFrom(c.packed_source)}${c.packed_at ? ` at ${hhmm(c.packed_at)}` : ''}`,
      'Your scan was not counted. Check the box was not packed twice.'
    );
  }
}

// --- Events ----------------------------------------------------------------

export function recordPackEvent(spec: RecordSpec): PackEvent {
  const event: PackEvent = {
    event_id: uuid(),
    seq: meta.nextSeq,
    at: new Date().toISOString(),
    kind: spec.kind,
    result: spec.result,
    package_key: spec.packageKey,
    order_keys: spec.orderKeys,
    sku: spec.sku,
    raw: spec.raw,
    undoes: spec.undoes ?? null,
  };
  events = [...events, { event, acceptedAt: null }];
  meta = { ...meta, nextSeq: meta.nextSeq + 1 };
  writeJson(EVENTS_FILE, events);
  writeJson(META_FILE, meta);
  notify(true);
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
  if (sending || fetching) {
    return;
  }
  sending = true;
  let conflicted = false;
  try {
    for (;;) {
      const batch = events.filter((e) => e.acceptedAt === null).slice(0, SEND_BATCH);
      if (batch.length === 0) {
        break;
      }
      const response = await postPackEvents(
        getPickSnapshot().serverUrl,
        DEVICE,
        meta.installId,
        batch.map((e) => e.event)
      );
      // Conflicting events are accepted too: they leave the queue and are never resent.
      const acceptedIds = new Set(response.accepted);
      const now = Date.now();
      events = events.map((e) =>
        e.acceptedAt === null && acceptedIds.has(e.event.event_id) ? { ...e, acceptedAt: now } : e
      );
      writeJson(EVENTS_FILE, events);
      sendError = null;
      // Accepted after the last fetch: still unreflected, so the board is unchanged.
      notify();
      const conflicts = response.conflicts ?? [];
      if (conflicts.length > 0) {
        conflicted = true;
        reportConflicts(conflicts);
      }
      if (acceptedIds.size === 0) {
        break;
      }
    }
  } catch (error) {
    console.warn('Sending pack events failed:', error);
    sendError = error instanceof Error ? error.message : String(error);
    notify();
  } finally {
    sending = false;
  }
  if (conflicted) {
    // The phone still counts those scans until the Mac's state replaces them.
    setTimeout(() => void quietReload(), 0);
  }
}

// --- Refresh -----------------------------------------------------------------

function imageUrls(server: PackServerState, onlyToPack: boolean): string[] {
  return server.packages
    .filter((p) => !onlyToPack || p.orders.some((o) => !o.packed_at))
    .flatMap((p) => p.items.flatMap((i) => [i.image_url, i.image_url_full]))
    .filter((u): u is string => Boolean(u));
}

type RefreshOptions = {
  /** Automatic reload: no spinner, no error text, never waits behind another refresh. */
  silent?: boolean;
  timeoutMs?: number;
};

/**
 * load=true fetches the labels bought in the last `hours` (eBay + Shopify) first.
 * Resolves true when a fresh state arrived.
 */
export async function refreshPackState(
  load: boolean,
  hours = DEFAULT_LOAD_HOURS,
  { silent = false, timeoutMs }: RefreshOptions = {}
): Promise<boolean> {
  if (busy) {
    if (silent) {
      return false;
    }
    // A quiet reload is under way: the packer's own refresh runs right after it.
    while (busy) {
      await sleep(100);
    }
  }
  busy = true;
  if (!silent) {
    refreshing = load ? 'load' : 'quick';
    refreshError = null;
    if (load) {
      requestedLoadHours = hours;
    }
    notify();
  }
  let ok = false;
  let poll = false;
  try {
    // Hand the Mac everything first, so the state it returns already counts it.
    await flushEvents();
    while (sending) {
      await sleep(100);
    }
    fetching = true;
    const fetchStartedAt = Date.now();
    const before = board;
    const beforeOpen = openKey;
    const server = await fetchPackState(getPickSnapshot().serverUrl, load, hours, timeoutMs);
    ok = true;
    lastFetchAt = Date.now();
    poll = server.load_running === true;

    const prevVersion = state.server?.server_version;
    const acceptedSince = events.some(
      (e) => e.acceptedAt !== null && state.fetchStartedAt !== null && e.acceptedAt > state.fetchStartedAt
    );
    const unchanged =
      !load &&
      server.server_version != null &&
      server.server_version === prevVersion &&
      server.load_running === state.server?.load_running &&
      !acceptedSince;

    if (unchanged) {
      // Same records as on screen: keep the board, just move the fetch mark.
      state = { ...state, fetchStartedAt, loadedAt: new Date().toISOString() };
    } else {
      state = { server, fetchStartedAt, loadedAt: new Date().toISOString() };
      writeJson(STATE_FILE, state);
      const cutoff = Date.now() - KEEP_ACCEPTED_MS;
      events = events.filter((e) => e.acceptedAt === null || e.acceptedAt > cutoff);
      writeJson(EVENTS_FILE, events);
      void packImages.prefetch(imageUrls(server, true));
      if (load) {
        packImages.cleanup(imageUrls(server, false));
      }
      notify(true);
      followOpenPackage(before, beforeOpen);
    }

    if (load && !silent && server.load_status !== 'ok') {
      refreshError =
        server.load_status === 'timeout'
          ? 'Labels still loading on the Mac; showing what is there.'
          : `Load labels failed${server.load_error ? `: ${server.load_error}` : ''}`;
    }
  } catch (error) {
    if (!silent) {
      refreshError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    fetching = false;
    busy = false;
    if (!silent) {
      refreshing = null;
    }
    notify();
    scheduleSend();
    scheduleLoadPoll(poll);
  }
  return ok;
}

/** Automatic reload: quiet, and skipped if another refresh is under way. */
function quietReload(timeoutMs?: number): Promise<boolean> {
  return refreshPackState(false, DEFAULT_LOAD_HOURS, { silent: true, timeoutMs });
}

/** While a Load labels runs on the Mac, look again every 15 s until it's done. */
function scheduleLoadPoll(running: boolean) {
  if (loadPollTimer) {
    clearTimeout(loadPollTimer);
    loadPollTimer = null;
  }
  if (running) {
    loadPollTimer = setTimeout(() => {
      loadPollTimer = null;
      void quietReload();
    }, LOAD_POLL_MS);
  }
}

/**
 * After a reload: keep the open package on screen even if a later load gave it
 * another key (a combined-shipping order joined it), and tell the packer when
 * the other side packed it.
 */
function followOpenPackage(before: Board, beforeOpen: string | null) {
  if (!openKey) {
    return;
  }
  if (!board.byKey.has(openKey)) {
    const moved = board.orderIndex.get(openKey);
    if (moved) {
      openKey = moved;
      notify();
    }
  }
  const was = beforeOpen ? before.byKey.get(beforeOpen) : undefined;
  const now = board.byKey.get(openKey);
  if (was && !was.packedAt && now?.packedAt && now.packedSource !== 'phone') {
    pushNotice(
      `${now.pkg.name} was packed${whereFrom(now.packedSource)} at ${hhmm(now.packedAt)}`,
      'Check the box before packing it again.'
    );
  }
}

/**
 * Before Mark packed: if the state is older than 30 s, reload it (at most ~3 s),
 * so a package the desktop just packed isn't marked again. Offline, go ahead.
 */
export async function ensureFresh(): Promise<void> {
  if (Date.now() - lastFetchAt < FRESH_MAX_AGE_MS) {
    return;
  }
  await Promise.race([quietReload(FRESH_TIMEOUT_MS), sleep(FRESH_TIMEOUT_MS + 500)]);
}

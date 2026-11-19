import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { getSnapshot as getPickSnapshot } from '../pick/store';
import { deriveLineStates, labelSku, type LineState, type LocalEvent } from '../pick/derive';
import { createImageCache } from '../pick/images';
import type { PickAction, PickLine } from '../pick/types';
import { fetchPlan, fetchShows, postWhatnotEvents } from './api';
import type { ShowIndex, WhatnotEvent, WhatnotLine, WhatnotPlan } from './types';

// Whatnot show pick state. Same safety rules as order Pick (lib/pick/store.ts):
// every event is written to disk first, then sent in the background and
// retried until the Mac accepts it. Files under Documents/whatnot-pick/:
//
//   state.json          the show index + the open show
//   plans/<id>.json     each loaded lineup, with when its request started
//   events.json         every Whatnot pick event made on this phone
//
// Unlike orders there is no re-sync step: the plan is read straight from the
// Mac DB, so the list is (re)loaded on its own when the mode or show opens
// and when the app comes back to the front. design.md §4.

export type PlanCache = {
  plan: WhatnotPlan;
  /** When this plan's request started (ms); events accepted before it are in it. */
  fetchStartedAt: number;
  loadedAt: string;
};

type Persisted = {
  shows: ShowIndex | null;
  showsLoadedAt: string | null;
  selectedPlanId: number | null;
};

export type WhatnotSnapshot = Persisted & {
  plan: PlanCache | null;
  events: LocalEvent[];
  online: boolean | null;
  refreshing: boolean;
  refreshError: string | null;
  /** The lineup changed on the Mac while picks were unsent: reload before laying out. */
  stale: boolean;
  unsentCount: number;
};

const ROOT = new Directory(Paths.document, 'whatnot-pick');
const PLANS = new Directory(ROOT, 'plans');
const STATE_FILE = new File(ROOT, 'state.json');
const EVENTS_FILE = new File(ROOT, 'events.json');

const SEND_DELAY_MS = 500;
const RETRY_INTERVAL_MS = 30_000;
const SEND_BATCH = 200;
const KEEP_ACCEPTED_MS = 3 * 24 * 3600 * 1000;
const DEVICE = `${Constants.deviceName ?? 'iPhone'} / app ${Constants.expoConfig?.version ?? '?'}`;

const images = createImageCache('whatnot-pick-images');
export const whatnotImageUri = images.uri;

let state: Persisted = { shows: null, showsLoadedAt: null, selectedPlanId: null };
let plan: PlanCache | null = null;
let events: LocalEvent[] = [];
let online: boolean | null = null;
let refreshing = false;
let refreshError: string | null = null;
let stale = false;
let sending = false;
let started = false;
let active = false; // Whatnot mode on screen: auto-load on foreground
let sendTimer: ReturnType<typeof setTimeout> | null = null;

let snapshot = build();
const listeners = new Set<() => void>();

function build(): WhatnotSnapshot {
  return {
    ...state,
    plan,
    events,
    online,
    refreshing,
    refreshError,
    stale,
    unsentCount: events.filter((e) => e.acceptedAt === null).length,
  };
}

function notify() {
  snapshot = build();
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

export function getWhatnotSnapshot(): WhatnotSnapshot {
  return snapshot;
}

const serverUrl = () => getPickSnapshot().serverUrl;

// --- Disk ------------------------------------------------------------------

function writeJson(dir: Directory, file: File, value: unknown) {
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `${file.name}.tmp`);
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

const planFile = (id: number) => new File(PLANS, `${id}.json`);
const saveState = () => writeJson(ROOT, STATE_FILE, state);
const saveEvents = () => writeJson(ROOT, EVENTS_FILE, events);

function loadPlanCache(id: number | null): PlanCache | null {
  return id === null ? null : readJson<PlanCache>(planFile(id));
}

// --- Lifecycle -------------------------------------------------------------

export function startWhatnotStore() {
  if (started) {
    return;
  }
  started = true;
  state = { ...state, ...(readJson<Persisted>(STATE_FILE) ?? {}) };
  events = readJson<LocalEvent[]>(EVENTS_FILE) ?? [];
  plan = loadPlanCache(state.selectedPlanId);
  notify();
  AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      void (active ? refreshAll() : flushEvents());
    }
  });
  setInterval(() => {
    if (events.some((e) => e.acceptedAt === null)) {
      void flushEvents();
    }
  }, RETRY_INTERVAL_MS);
  void flushEvents();
}

/** Whatnot mode shown or hidden; showing it (re)loads the shows and the open show. */
export function setWhatnotActive(on: boolean) {
  const was = active;
  active = on;
  if (on && !was) {
    void refreshAll();
  }
}

// --- Loading ---------------------------------------------------------------

async function waitForSend() {
  await flushEvents();
  while (sending) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Show index, then the open show (or the soonest one). */
export async function refreshAll(): Promise<void> {
  if (refreshing) {
    return;
  }
  await waitForSend();
  refreshing = true;
  refreshError = null;
  notify();
  try {
    const shows = await fetchShows(serverUrl());
    const ids = shows.shows.map((s) => s.plan_id);
    const selected =
      state.selectedPlanId !== null && ids.includes(state.selectedPlanId) ? state.selectedPlanId : (ids[0] ?? null);
    state = { shows, showsLoadedAt: new Date().toISOString(), selectedPlanId: selected };
    saveState();
    online = true;
    if (selected === null) {
      plan = null;
    } else {
      await loadPlan(selected);
    }
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error);
    online = false;
  } finally {
    refreshing = false;
    notify();
    scheduleSend();
  }
}

async function loadPlan(id: number) {
  const fetchStartedAt = Date.now();
  const fresh = await fetchPlan(serverUrl(), id);
  plan = { plan: fresh, fetchStartedAt, loadedAt: new Date().toISOString() };
  writeJson(PLANS, planFile(id), plan);
  stale = false;
  const cutoff = Date.now() - KEEP_ACCEPTED_MS;
  events = events.filter((e) => e.acceptedAt === null || e.acceptedAt > cutoff);
  saveEvents();
  const urls = (lines: { image_url: string | null; image_url_full: string | null }[]) =>
    lines.flatMap((l) => [l.image_url, l.image_url_full]).filter((u): u is string => Boolean(u));
  const keep = [...urls(fresh.lines), ...urls(fresh.removed_in_prep)];
  images.cleanup(keep);
  void images.prefetch(urls(fresh.lines.filter((l) => l.status === 'open' || l.status === 'missing')));
}

/** Reload just the open show (pull-to-refresh, "Lineup changed" bar). */
export async function refreshPlan(): Promise<void> {
  if (refreshing || state.selectedPlanId === null) {
    return refreshAll();
  }
  await waitForSend();
  refreshing = true;
  refreshError = null;
  notify();
  try {
    await loadPlan(state.selectedPlanId);
    online = true;
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error);
    online = false;
  } finally {
    refreshing = false;
    notify();
    scheduleSend();
  }
}

export async function selectShow(id: number): Promise<void> {
  state = { ...state, selectedPlanId: id };
  saveState();
  plan = loadPlanCache(id);
  stale = false;
  notify();
  await refreshPlan();
}

// --- Events ----------------------------------------------------------------

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function planIdOf(lineKey: string): number | null {
  const m = /^wn:(\d+):/.exec(lineKey);
  return m ? Number(m[1]) : null;
}

export type WhatnotRecordInput = {
  action: PickAction;
  line?: PickLine | null;
  /** SKU for events without a line (a rejected scan). */
  sku?: string | null;
  boxId: string | null;
  method?: 'scan' | 'manual';
  scannedValue?: string | null;
  note?: string | null;
};

export function recordWhatnotEvent(input: WhatnotRecordInput): WhatnotEvent | null {
  const planId = (input.line && planIdOf(input.line.line_key)) ?? state.selectedPlanId;
  const sku = input.line?.sku ?? input.sku ?? input.scannedValue ?? null;
  if (planId === null || !sku) {
    return null;
  }
  const event: WhatnotEvent = {
    event_id: uuid(),
    plan_id: planId,
    snapshot_id: plan?.plan.plan_version ?? null,
    line_key: input.line?.line_key ?? null,
    order_id: null,
    sku,
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
  if (sending || refreshing) {
    return;
  }
  sending = true;
  let changed = false;
  try {
    for (;;) {
      const batch = events.filter((e) => e.acceptedAt === null).slice(0, SEND_BATCH);
      if (batch.length === 0) {
        break;
      }
      const reply = await postWhatnotEvents(serverUrl(), DEVICE, batch.map((e) => e.event as WhatnotEvent));
      const accepted = new Set(reply.accepted);
      const now = Date.now();
      events = events.map((e) =>
        e.acceptedAt === null && accepted.has(e.event.event_id) ? { ...e, acceptedAt: now } : e
      );
      saveEvents();
      online = true;
      const version = plan ? reply.plan_versions?.[String(plan.plan.plan_id)] : undefined;
      if (version && plan && version !== plan.plan.plan_version) {
        changed = true;
      }
      notify();
      if (accepted.size === 0) {
        break;
      }
    }
  } catch (error) {
    console.warn('Sending Whatnot pick events failed:', error);
    online = false;
    notify();
  } finally {
    sending = false;
  }
  if (changed) {
    // The lineup changed on the Mac. Nothing left to send: reload it quietly;
    // otherwise ask before reloading (the bar on the show card).
    if (events.some((e) => e.acceptedAt === null)) {
      stale = true;
      notify();
    } else {
      void refreshPlan();
    }
  }
}

// --- Derived ----------------------------------------------------------------

/** A Whatnot line in order Pick's shape, so its grouping and scan rules apply unchanged. */
export function toPickLine(line: WhatnotLine, planId: number): PickLine {
  const done = line.status === 'picked' || line.status === 'sold';
  return {
    line_key: line.line_key,
    store: 'whatnot',
    order_id: `plan-${planId}`,
    // Sorts lines by lot where order Pick sorts by order date.
    order_date: String(line.lot).padStart(4, '0'),
    buyer: '',
    sku: line.sku,
    title: line.title ?? '',
    qty: 1,
    image_url: line.image_url,
    image_url_full: line.image_url_full,
    room: line.room,
    box_id: line.box_id,
    other_boxes: [],
    nearby_boxes: [],
    picked_qty: done ? 1 : 0,
    status: line.status === 'sold' ? 'picked' : line.status,
  };
}

export function whatnotLineStates(snap: WhatnotSnapshot = snapshot): Map<string, LineState> {
  if (!snap.plan) {
    return new Map();
  }
  const id = snap.plan.plan.plan_id;
  const mine = snap.events.filter((e) => planIdOf(e.event.line_key ?? '') === id);
  return deriveLineStates(snap.plan.plan.lines.map((l) => toPickLine(l, id)), mine, snap.plan.fetchStartedAt);
}

/** The open show's line for a scanned SKU (for order Pick's "is #07 on …" banner). */
export function findInShow(code: string): { line: WhatnotLine; title: string } | null {
  const p = snapshot.plan?.plan;
  const line = p?.lines.find((l) => labelSku(l.sku) === code && l.status !== 'sold');
  return p && line ? { line, title: p.title } : null;
}

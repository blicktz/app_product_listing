import { AppState } from 'react-native';
import * as Network from 'expo-network';
import * as MediaLibrary from 'expo-media-library';
import { MacServerError, checkHealth } from '../pick/api';
import { getSnapshot as getPickSnapshot, type UploadDestination } from '../pick/store';
import { logShootEvent } from '../shootLog/store';
import { sleep } from '../sleep';
import { sidecarFilename } from '../photoSidecar';
import {
  deleteJobDir,
  deleteJobPayload,
  getLedgerMax,
  jobFile,
  loadAllJobs,
  photoFilename,
  recordLedgerMax,
  saveJob,
  type UploadJob,
  type WaitReason,
} from './store';
import { destinationName, lookupNumbers, prepareSender, type SendFile } from './destinations';
import { jobUploadFiles, prepareListingEnv, preparePhoto } from './prepare';

// Upload queue. One job (= one finished SKU session) is processed at a time,
// oldest first: prepare (crop + sidecar), collision check, upload, to whichever
// destination the job is on (see destinations.ts). A job that keeps failing
// parks as `failed` and stays on disk; it is retried whenever the network comes
// back, the app returns to the foreground, every few minutes while open, or by
// hand from the Upload Queue screen. Nothing is ever deleted until the
// destination has confirmed every file, or the user deletes it.

const MAX_UPLOAD_ATTEMPTS = 5;
const UPLOAD_RETRY_BASE_DELAY_MS = 10_000; // wait before the 1st retry
const UPLOAD_RETRY_BACKOFF_FACTOR = 1.5; // ~10s, 15s, 22s, 30s
const UPLOAD_RETRY_MAX_DELAY_MS = 30_000; // cap
const FAILED_SWEEP_INTERVAL_MS = 5 * 60_000;
const MAC_RECHECK_INTERVAL_MS = 30_000;
// One failed health check speaks for the whole pass, so a long queue doesn't
// wait out the health timeout once per job.
const MAC_DOWN_MEMORY_MS = 10_000;
// Cropping right after a shutter press causes shutter lag (see e042b94), so
// prepare work waits until the camera has been quiet this long.
const CAPTURE_QUIET_MS = 3000;

export type QueueSnapshot = {
  jobs: UploadJob[];
  /** null until the first network state read. */
  online: boolean | null;
  activeJobId: string | null;
};

let jobs: UploadJob[] = [];
let online: boolean | null = null;
let activeJobId: string | null = null;
let snapshot: QueueSnapshot = { jobs, online, activeJobId };
const listeners = new Set<() => void>();

let started = false;
let running = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let lastCaptureAt = 0;
let macDownUntil = 0;

function notify() {
  // The runner mutates its jobs in place; hand React fresh copies so list rows
  // and compiler-memoized values see every change (identity comparison).
  snapshot = {
    jobs: jobs.map((job) => JSON.parse(JSON.stringify(job)) as UploadJob),
    online,
    activeJobId,
  };
  for (const listener of listeners) {
    listener();
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): QueueSnapshot {
  return snapshot;
}

function persist(job: UploadJob) {
  saveJob(job);
  notify();
}

function localDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'Upload timed out' : error.message;
  }
  return String(error);
}

// --- Lifecycle ---------------------------------------------------------------

export function startUploadQueue() {
  if (started) {
    return;
  }
  started = true;

  const today = localDate(new Date());
  jobs = [];
  for (const job of loadAllJobs()) {
    if (job.status === 'done') {
      // "Completed today" only; older finished jobs are just history.
      if (!job.completedAt || localDate(new Date(job.completedAt)) !== today) {
        deleteJobDir(job.id);
        continue;
      }
    } else if (job.status === 'preparing' || job.status === 'uploading') {
      // Interrupted by a quit/crash: just run it again. `uploaded` keeps what
      // already made it, so nothing is sent twice.
      job.status = 'queued';
      saveJob(job);
    } else if (job.status === 'waiting-retry') {
      job.nextAttemptAt = Date.now();
    }
    jobs.push(job);
  }
  notify();

  Network.getNetworkStateAsync()
    .then((state) => setOnline(state.isConnected !== false))
    .catch(() => setOnline(true));
  Network.addNetworkStateListener((state) => setOnline(state.isConnected !== false));

  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      retryAll();
    }
  });
  setInterval(() => retryAll(), FAILED_SWEEP_INTERVAL_MS);
  setInterval(() => void rearmJobsWaitingForMac(), MAC_RECHECK_INTERVAL_MS);

  kick();
}

/** Jobs waiting on the Mac start again only once it answers. */
async function rearmJobsWaitingForMac() {
  const parked = jobs.filter(
    (job) => job.status === 'waiting-retry' && (job.waitReason === 'mac' || job.waitReason === 'drive')
  );
  if (parked.length === 0 || !(await macReachable())) {
    return;
  }
  for (const job of parked) {
    if (job.status === 'waiting-retry') {
      resetForRetry(job);
    }
  }
  notify();
  kick();
}

async function macReachable(): Promise<boolean> {
  if (Date.now() < macDownUntil) {
    return false;
  }
  const reachable = await checkHealth(getPickSnapshot().serverUrl);
  if (!reachable) {
    macDownUntil = Date.now() + MAC_DOWN_MEMORY_MS;
  }
  return reachable;
}

function setOnline(value: boolean) {
  const cameBack = value && online === false;
  online = value;
  notify();
  if (cameBack) {
    retryAll();
  } else {
    kick();
  }
}

/** Called by the camera on every shutter press; defers cropping work. */
export function notifyCaptureActivity() {
  lastCaptureAt = Date.now();
}

// --- Public actions ------------------------------------------------------------

export function enqueue(job: UploadJob) {
  saveJob(job);
  const maxNumber = Math.max(0, ...job.photos.map((photo) => photo.number));
  recordLedgerMax(job.dateRoot, job.sku, maxNumber);
  jobs.push(job);
  const shotTimes = job.photos.map((photo) => photo.metadata.capturedAt).sort();
  logJob('session_shot', job, {
    numbers: job.photos.map((photo) => photo.number),
    shot_started_at: shotTimes[0],
    shot_ended_at: shotTimes[shotTimes.length - 1],
    item_condition: job.listing?.itemCondition ?? null,
    ebay_store: job.listing?.ebayStore ?? null,
    destination: getPickSnapshot().uploadDestination,
    numbered_offline: job.numberedOffline,
  });
  notify();
  kick();
}

function logJob(
  action: Parameters<typeof logShootEvent>[0]['action'],
  job: UploadJob,
  details: Omit<Parameters<typeof logShootEvent>[0], 'action' | 'sessionId' | 'dateRoot' | 'sku'> = {}
) {
  logShootEvent({ action, sessionId: job.id, dateRoot: job.dateRoot, sku: job.sku, ...details });
}

/** Photo numbers of this job that its destination hasn't confirmed. */
function unsentNumbers(job: UploadJob): number[] {
  return job.photos
    .filter((photo) => !job.uploaded.includes(photoFilename(job.sku, photo.number)))
    .map((photo) => photo.number);
}

function resetForRetry(job: UploadJob) {
  job.status = 'queued';
  job.attempts = 0;
  job.nextAttemptAt = null;
  saveJob(job);
}

export function retry(jobId: string) {
  const job = jobs.find((j) => j.id === jobId);
  if (job && (job.status === 'failed' || job.status === 'waiting-retry')) {
    macDownUntil = 0;
    resetForRetry(job);
    notify();
    kick();
  }
}

/** Re-arm every failed or waiting job. Conflicts and rejections need a human decision first. */
export function retryAll() {
  macDownUntil = 0;
  let changed = false;
  for (const job of jobs) {
    if (job.status === 'failed' || job.status === 'waiting-retry') {
      resetForRetry(job);
      changed = true;
    }
  }
  if (changed) {
    notify();
  }
  kick();
}

export function remove(jobId: string) {
  if (jobId === activeJobId) {
    return;
  }
  const job = jobs.find((j) => j.id === jobId);
  if (job && job.status !== 'done') {
    logJob('deleted_from_phone', job, { numbers: unsentNumbers(job) });
  }
  deleteJobDir(jobId);
  jobs = jobs.filter((job) => job.id !== jobId);
  notify();
}

/** Clear "Completed today" entries. */
export function clearCompleted() {
  for (const job of jobs.filter((j) => j.status === 'done')) {
    deleteJobDir(job.id);
  }
  jobs = jobs.filter((job) => job.status !== 'done');
  notify();
}

/**
 * Move a conflicting job's photos to numbers after everything at the
 * destination (and everything queued on this phone), then requeue it. Only
 * valid before any photo of the job has uploaded, which the conflict rules in
 * processJob guarantee.
 */
export async function renumber(jobId: string): Promise<void> {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'conflict') {
    return;
  }
  const remote = await lookupNumbers(resolveDestination(job), job.dateRoot, job.sku);
  let next = Math.max(remote.nextNumber, getLedgerMax(job.dateRoot, job.sku) + 1);
  const fromNumbers = job.photos.map((photo) => photo.number);

  for (const photo of job.photos) {
    const oldName = photoFilename(job.sku, photo.number);
    const newName = photoFilename(job.sku, next);
    const jpg = jobFile(job.id, oldName);
    if (jpg.exists) {
      jpg.moveSync(jobFile(job.id, newName), { overwrite: true });
    }
    // The sidecar names its photo, so rewrite it rather than just renaming.
    const oldJson = jobFile(job.id, sidecarFilename(oldName));
    if (oldJson.exists) {
      const sidecar = JSON.parse(oldJson.textSync());
      sidecar.filename = newName;
      oldJson.delete();
      const newJson = jobFile(job.id, sidecarFilename(newName));
      if (!newJson.exists) {
        newJson.create();
      }
      newJson.write(JSON.stringify(sidecar, null, 2));
    }
    photo.number = next++;
  }

  job.uploaded = job.uploaded.filter((name) => !/\.(jpg|json)$/i.test(name));
  job.collisionChecked = false;
  job.numberedOffline = false;
  job.lastError = null;
  resetForRetry(job);
  recordLedgerMax(job.dateRoot, job.sku, next - 1);
  logJob('renumbered', job, {
    from_numbers: fromNumbers,
    to_numbers: job.photos.map((photo) => photo.number),
  });
  notify();
  kick();
}

/** Last-resort export: copy the job's photos into a camera-roll album. */
export async function exportToPhotos(jobId: string): Promise<number> {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    return 0;
  }
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) {
    throw new Error('Photo library permission was not granted.');
  }
  const uris: string[] = [];
  for (const photo of job.photos) {
    const prepared = jobFile(job.id, photoFilename(job.sku, photo.number));
    const raw = photo.rawFile ? jobFile(job.id, photo.rawFile) : null;
    if (prepared.exists) {
      uris.push(prepared.uri);
    } else if (raw?.exists) {
      uris.push(raw.uri);
    }
  }
  if (uris.length === 0) {
    return 0;
  }
  await MediaLibrary.Album.create(`Unuploaded – ${job.dateRoot} ${job.sku}`, uris, false);
  logJob('exported_to_photos', job, { photo_count: uris.length });
  return uris.length;
}

// --- Queries for Home ------------------------------------------------------------

/** Highest photo number ever queued on this phone for the SKU (0 if none). */
export function localMaxNumber(dateRoot: string, sku: string): number {
  return getLedgerMax(dateRoot, sku);
}

/** Photos of this SKU still waiting on this phone (not yet at the destination). */
export function pendingPhotoCount(queued: UploadJob[], dateRoot: string, sku: string): number {
  let count = 0;
  for (const job of queued) {
    if (job.dateRoot !== dateRoot || job.sku !== sku || job.status === 'done') {
      continue;
    }
    for (const photo of job.photos) {
      if (!job.uploaded.includes(photoFilename(job.sku, photo.number))) {
        count++;
      }
    }
  }
  return count;
}

// --- Runner loop -----------------------------------------------------------------

function nextRunnable(): UploadJob | undefined {
  const now = Date.now();
  return jobs.find(
    (job) =>
      job.status === 'queued' ||
      (job.status === 'waiting-retry' && job.nextAttemptAt !== null && job.nextAttemptAt <= now)
  );
}

function scheduleWake() {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  const waits = jobs
    .filter((job) => job.status === 'waiting-retry' && job.nextAttemptAt !== null)
    .map((job) => job.nextAttemptAt as number);
  if (waits.length > 0) {
    const delay = Math.max(Math.min(...waits) - Date.now(), 250);
    wakeTimer = setTimeout(kick, delay);
  }
}

function kick() {
  if (!started || running) {
    return;
  }
  running = true;
  void (async () => {
    try {
      let job = nextRunnable();
      while (job) {
        activeJobId = job.id;
        await processJob(job);
        activeJobId = null;
        notify();
        job = nextRunnable();
      }
    } catch (error) {
      console.warn('Upload queue runner error:', error);
    } finally {
      activeJobId = null;
      running = false;
      scheduleWake();
    }
  })();
}

async function waitForQuietCamera() {
  let quietFor = Date.now() - lastCaptureAt;
  while (quietFor < CAPTURE_QUIET_MS) {
    await sleep(CAPTURE_QUIET_MS - quietFor);
    quietFor = Date.now() - lastCaptureAt;
  }
}

function markFailed(job: UploadJob, message: string) {
  job.status = 'failed';
  job.nextAttemptAt = null;
  job.waitReason = null;
  job.lastError = message;
  if (!job.failureLogged) {
    job.failureLogged = true;
    logJob('upload_failed', job, { error: message });
  }
  persist(job);
}

function failAttempt(job: UploadJob, message: string) {
  job.attempts += 1;
  job.lastError = message;
  job.waitReason = null;
  if (job.attempts >= MAX_UPLOAD_ATTEMPTS) {
    markFailed(job, message);
    return;
  }
  const delay = Math.min(
    Math.round(UPLOAD_RETRY_BASE_DELAY_MS * UPLOAD_RETRY_BACKOFF_FACTOR ** (job.attempts - 1)),
    UPLOAD_RETRY_MAX_DELAY_MS
  );
  job.status = 'waiting-retry';
  job.nextAttemptAt = Date.now() + delay;
  persist(job);
}

/** Wait without using an attempt; something else re-arms the job. */
function park(job: UploadJob, reason: WaitReason, message: string) {
  job.status = 'waiting-retry';
  job.nextAttemptAt = null;
  job.waitReason = reason;
  job.lastError = message;
  persist(job);
}

function markConflict(job: UploadJob, numbers: number[], message: string) {
  job.status = 'conflict';
  job.nextAttemptAt = null;
  job.waitReason = null;
  job.lastError = message;
  logJob('upload_conflict', job, { numbers });
  persist(job);
}

function markRejected(job: UploadJob, httpStatus: number | undefined, message: string) {
  job.status = 'rejected';
  job.nextAttemptAt = null;
  job.waitReason = null;
  job.lastError = message;
  logJob('upload_rejected', job, { http_status: httpStatus, error: message });
  persist(job);
}

/** Follows the setting until a file has been confirmed, so one job is never split. */
function resolveDestination(job: UploadJob): UploadDestination {
  if (job.uploaded.length > 0) {
    // Only jobs from before the Mac option exist without one, and those went to R2.
    job.destination ??= 'r2';
    return job.destination;
  }
  const current = getPickSnapshot().uploadDestination;
  if (job.destination !== current) {
    job.destination = current;
    job.collisionChecked = false;
  }
  return current;
}

/** Mac answers that aren't worth an attempt. True if the job was handled. */
function handleMacError(job: UploadJob, error: unknown): boolean {
  if (error instanceof MacServerError && error.status === 503) {
    park(job, 'drive', 'Mac drive offline');
    return true;
  }
  if (error instanceof MacServerError && error.status === 401) {
    markFailed(job, 'The Mac refused this phone. Check the Mac token.');
    return true;
  }
  return false;
}

function numberInFilename(filename: string): number[] {
  const match = filename.match(/_(\d+)\.(?:jpg|json)$/i);
  return match ? [Number(match[1])] : [];
}

async function processJob(job: UploadJob) {
  // 1. Prepare: crop/resize + sidecar per photo, one at a time, between shots.
  if (!job.prepared) {
    job.status = 'preparing';
    persist(job);
    try {
      for (const photo of job.photos) {
        if (photo.rawFile) {
          await waitForQuietCamera();
          await preparePhoto(job, photo);
          persist(job);
        }
      }
      prepareListingEnv(job);
      job.prepared = true;
      persist(job);
    } catch (error) {
      console.warn(`Preparing ${job.sku} failed:`, error);
      failAttempt(job, `Could not prepare photos: ${errorMessage(error)}`);
      return;
    }
  }

  // Offline: park without burning a retry; the network listener re-arms it.
  if (online === false) {
    park(job, 'network', 'Offline – waiting for network');
    return;
  }

  // Having a network doesn't mean being on home Wi-Fi with the Mac awake.
  const destination = resolveDestination(job);
  if (destination === 'mac' && !(await macReachable())) {
    park(job, 'mac', 'Waiting for Mac');
    return;
  }

  job.status = 'uploading';
  job.waitReason = null;
  job.lastError = null;
  persist(job);

  // 2. Never overwrite photos already there (offline numbering, other device).
  if (!job.collisionChecked) {
    try {
      const remote = await lookupNumbers(destination, job.dateRoot, job.sku);
      const taken = new Set(remote.numbers ?? []);
      const clashes = job.photos.filter(
        (photo) =>
          !job.uploaded.includes(photoFilename(job.sku, photo.number)) &&
          (remote.numbers ? taken.has(photo.number) : photo.number < remote.nextNumber)
      );
      if (clashes.length > 0) {
        const place = destinationName(destination);
        markConflict(
          job,
          clashes.map((p) => p.number),
          `${place[0].toUpperCase()}${place.slice(1)} already has ` +
            `${clashes.map((p) => `_${String(p.number).padStart(2, '0')}`).join(', ')} ` +
            `for ${job.sku}. Renumber to upload after them.`
        );
        return;
      }
      job.collisionChecked = true;
      persist(job);
    } catch (error) {
      if (!handleMacError(job, error)) {
        failAttempt(job, errorMessage(error));
      }
      return;
    }
  }

  // 3. Upload whatever the destination hasn't confirmed yet.
  const pending = jobUploadFiles(job).filter((file) => !job.uploaded.includes(file.filename));
  let lastError: string | null = null;

  if (pending.length > 0) {
    let send: SendFile;
    try {
      send = await prepareSender(
        destination,
        job,
        pending.map((file) => file.filename)
      );
    } catch (error) {
      failAttempt(job, errorMessage(error));
      return;
    }

    for (const { filename, contentType } of pending) {
      try {
        const file = jobFile(job.id, filename);
        if (!file.exists) {
          throw new Error(`${filename} is missing on this phone`);
        }
        const outcome = await send(filename, contentType, file);
        switch (outcome.kind) {
          case 'ok':
            job.uploaded.push(filename);
            persist(job);
            break;
          case 'retry':
            lastError = outcome.message;
            break;
          case 'drive-offline':
            park(job, 'drive', outcome.message);
            return;
          case 'unauthorized':
            markFailed(job, outcome.message);
            return;
          case 'rejected':
            markRejected(job, outcome.httpStatus, outcome.message);
            return;
          case 'conflict':
            // listing.env is sent first and is always replaced, so it doesn't
            // count: Renumber is safe while no photo or sidecar has landed.
            if (job.uploaded.some((name) => /\.(jpg|json)$/i.test(name))) {
              markRejected(job, 409, `${outcome.message} Part of this job is already on the Mac.`);
            } else {
              markConflict(job, numberInFilename(filename), `${outcome.message} Renumber to upload after it.`);
            }
            return;
        }
      } catch (error) {
        lastError = errorMessage(error);
      }
    }
  }

  if (jobUploadFiles(job).every((file) => job.uploaded.includes(file.filename))) {
    job.status = 'done';
    job.completedAt = new Date().toISOString();
    job.lastError = null;
    job.nextAttemptAt = null;
    deleteJobPayload(job.id);
    logJob('upload_complete', job, { photo_count: job.photos.length, destination });
    persist(job);
    return;
  }

  failAttempt(job, lastError ?? 'Some files did not upload');
}

export function firstThumbnailUri(job: UploadJob): string | null {
  for (const photo of job.photos) {
    const candidates = [photoFilename(job.sku, photo.number), photo.rawFile];
    for (const name of candidates) {
      if (name) {
        const file = jobFile(job.id, name);
        if (file.exists) {
          return file.uri;
        }
      }
    }
  }
  return null;
}

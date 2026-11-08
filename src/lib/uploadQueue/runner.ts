import { AppState } from 'react-native';
import * as Network from 'expo-network';
import * as MediaLibrary from 'expo-media-library';
import { checkSku, presignUpload } from '../uploadApi';
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
} from './store';
import { jobUploadFiles, prepareListingEnv, preparePhoto } from './prepare';

// Background upload queue. One job (= one finished SKU session) is processed at
// a time, oldest first: prepare (crop + sidecar), R2 collision check, upload.
// A job that keeps failing parks as `failed` and stays on disk; it is retried
// whenever the network comes back, the app returns to the foreground, every
// few minutes while open, or by hand from the Upload Queue screen. Nothing is
// ever deleted until R2 has confirmed every file, or the user deletes it.

const MAX_UPLOAD_ATTEMPTS = 5;
const UPLOAD_RETRY_BASE_DELAY_MS = 10_000; // wait before the 1st retry
const UPLOAD_RETRY_BACKOFF_FACTOR = 1.5; // ~10s, 15s, 22s, 30s
const UPLOAD_RETRY_MAX_DELAY_MS = 30_000; // cap
const UPLOAD_TIMEOUT_MS = 60_000;
const FAILED_SWEEP_INTERVAL_MS = 5 * 60_000;
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

  kick();
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
  notify();
  kick();
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
    resetForRetry(job);
    notify();
    kick();
  }
}

/** Re-arm every failed or waiting job. Conflicts need a human decision first. */
export function retryAll() {
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
 * Move a conflicting job's photos to numbers after everything on R2 (and
 * everything queued on this phone), then requeue it. Only valid before any
 * photo of the job has uploaded, which the collision check guarantees.
 */
export async function renumber(jobId: string): Promise<void> {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'conflict') {
    return;
  }
  const remote = await checkSku(job.dateRoot, job.sku);
  let next = Math.max(remote.nextNumber, getLedgerMax(job.dateRoot, job.sku) + 1);

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
  return uris.length;
}

// --- Queries for Home ------------------------------------------------------------

/** Highest photo number ever queued on this phone for the SKU (0 if none). */
export function localMaxNumber(dateRoot: string, sku: string): number {
  return getLedgerMax(dateRoot, sku);
}

/** Photos of this SKU still waiting on this phone (not yet on R2). */
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

function failAttempt(job: UploadJob, message: string) {
  job.attempts += 1;
  job.lastError = message;
  if (job.attempts >= MAX_UPLOAD_ATTEMPTS) {
    job.status = 'failed';
    job.nextAttemptAt = null;
  } else {
    const delay = Math.min(
      Math.round(UPLOAD_RETRY_BASE_DELAY_MS * UPLOAD_RETRY_BACKOFF_FACTOR ** (job.attempts - 1)),
      UPLOAD_RETRY_MAX_DELAY_MS
    );
    job.status = 'waiting-retry';
    job.nextAttemptAt = Date.now() + delay;
  }
  persist(job);
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
    job.status = 'waiting-retry';
    job.nextAttemptAt = null;
    job.lastError = 'Offline – waiting for network';
    persist(job);
    return;
  }

  job.status = 'uploading';
  persist(job);

  // 2. Never overwrite photos already on R2 (offline numbering, other device).
  if (!job.collisionChecked) {
    try {
      const remote = await checkSku(job.dateRoot, job.sku);
      const taken = new Set(remote.numbers ?? []);
      const clashes = job.photos.filter(
        (photo) =>
          !job.uploaded.includes(photoFilename(job.sku, photo.number)) &&
          (remote.numbers ? taken.has(photo.number) : photo.number < remote.nextNumber)
      );
      if (clashes.length > 0) {
        job.status = 'conflict';
        job.nextAttemptAt = null;
        job.lastError =
          `R2 already has ${clashes.map((p) => `_${String(p.number).padStart(2, '0')}`).join(', ')} ` +
          `for ${job.sku}. Renumber to upload after them.`;
        persist(job);
        return;
      }
      job.collisionChecked = true;
      persist(job);
    } catch (error) {
      failAttempt(job, errorMessage(error));
      return;
    }
  }

  // 3. Upload whatever R2 hasn't confirmed yet.
  const pending = jobUploadFiles(job).filter((file) => !job.uploaded.includes(file.filename));
  let lastError: string | null = null;

  if (pending.length > 0) {
    let uploadUrls: Record<string, string>;
    try {
      ({ uploadUrls } = await presignUpload(
        job.dateRoot,
        job.sku,
        pending.map((file) => file.filename)
      ));
    } catch (error) {
      failAttempt(job, errorMessage(error));
      return;
    }

    for (const { filename, contentType } of pending) {
      try {
        const url = uploadUrls[filename];
        if (!url) {
          throw new Error(`No upload URL returned for ${filename}`);
        }
        const file = jobFile(job.id, filename);
        if (!file.exists) {
          throw new Error(`${filename} is missing on this phone`);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        let status: number;
        try {
          // Streams from disk; the iOS background session keeps going if the
          // app is suspended mid-transfer.
          ({ status } = await file.upload(url, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': contentType },
            mimeType: contentType,
            sessionType: 'background',
            signal: controller.signal,
          }));
        } finally {
          clearTimeout(timeout);
        }
        if (status < 200 || status >= 300) {
          // 403 is usually an expired presign; the next pass presigns again.
          throw new Error(`Upload failed for ${filename} (${status})`);
        }
        job.uploaded.push(filename);
        persist(job);
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

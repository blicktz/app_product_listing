import { Directory, File, Paths } from 'expo-file-system';
import type { CaptureMetadata } from '../photoSidecar';
import type { ListingConfig } from '../listingConfig';
import type { UploadDestination } from '../pick/store';

// Durable, on-disk upload queue. Every finished SKU session becomes a job
// directory under Documents (not cache: iOS may purge cache, and a job must
// survive force-quits and reboots until its destination confirms it):
//
//   upload-queue/<jobId>/job.json         manifest (this file's UploadJob)
//   upload-queue/<jobId>/raw_<nn>.jpg     original captures, until prepared
//   upload-queue/<jobId>/<sku>_<nn>.jpg   cropped upload copy
//   upload-queue/<jobId>/<sku>_<nn>.json  capture-metadata sidecar
//   upload-queue/<jobId>/listing.env
//   upload-queue/ledger.json              highest number ever queued per SKU
//
// The folder is also exposed in the iOS Files app (UIFileSharingEnabled) as the
// last-resort way to get photos off the phone.

export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'waiting-retry'
  | 'failed'
  | 'conflict'
  /** Refused for good by the destination; automatic retries skip it. */
  | 'rejected'
  | 'done';

/** What a parked job is waiting for. */
export type WaitReason = 'network' | 'mac' | 'drive';

export type JobPhoto = {
  /** Photo number in `{sku}_{nn}.jpg`, fixed when the job is created. */
  number: number;
  /** Original capture in the job dir; null once the upload copy is prepared. */
  rawFile: string | null;
  width: number;
  height: number;
  metadata: CaptureMetadata;
};

export type UploadJob = {
  id: string;
  createdAt: string;
  dateRoot: string;
  sku: string;
  listing: ListingConfig | null;
  photos: JobPhoto[];
  /** The start number came from this phone's ledger because the destination was unreachable. */
  numberedOffline: boolean;
  status: JobStatus;
  /** Follows the setting until a file is confirmed, then fixed so a job is never split. */
  destination?: UploadDestination;
  waitReason?: WaitReason | null;
  /** upload_failed goes in the shoot log once per job. */
  failureLogged?: boolean;
  /** True once every upload file (jpg, json, listing.env) is written. */
  prepared: boolean;
  /** True once the destination's collision check passed for the current numbers. */
  collisionChecked: boolean;
  /** Filenames confirmed by the destination, so a retry only sends what's missing. */
  uploaded: string[];
  /** Attempts in the current retry round; reset by a manual/auto re-trigger. */
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  completedAt: string | null;
};

const ROOT = new Directory(Paths.document, 'upload-queue');
const LEDGER_FILE = new File(ROOT, 'ledger.json');
const MANIFEST = 'job.json';

function ensureRoot() {
  ROOT.create({ intermediates: true, idempotent: true });
}

export function jobDir(jobId: string): Directory {
  return new Directory(ROOT, jobId);
}

export function jobFile(jobId: string, name: string): File {
  return new File(jobDir(jobId), name);
}

export function photoFilename(sku: string, number: number): string {
  return `${sku}_${String(number).padStart(2, '0')}.jpg`;
}

export function newJobId(sku: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${stamp}_${sku}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Write the manifest via a temp file + move so a crash never leaves it half-written. */
export function saveJob(job: UploadJob) {
  const dir = jobDir(job.id);
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `${MANIFEST}.tmp`);
  if (tmp.exists) {
    tmp.delete();
  }
  tmp.create();
  tmp.write(JSON.stringify(job, null, 2));
  tmp.moveSync(new File(dir, MANIFEST), { overwrite: true });
}

export function loadAllJobs(): UploadJob[] {
  ensureRoot();
  const jobs: UploadJob[] = [];
  for (const entry of ROOT.list()) {
    if (!(entry instanceof Directory)) {
      continue;
    }
    const manifest = new File(entry, MANIFEST);
    try {
      if (!manifest.exists) {
        continue;
      }
      jobs.push(JSON.parse(manifest.textSync()) as UploadJob);
    } catch (error) {
      // A corrupt manifest must not hide the photos: the folder stays on disk
      // and is still reachable through the Files app.
      console.warn(`Could not read upload job ${entry.uri}:`, error);
    }
  }
  return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function deleteJobDir(jobId: string) {
  const dir = jobDir(jobId);
  if (dir.exists) {
    dir.delete();
  }
}

/** Delete everything in a finished job's folder except its manifest. */
export function deleteJobPayload(jobId: string) {
  const dir = jobDir(jobId);
  if (!dir.exists) {
    return;
  }
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name === MANIFEST) {
      continue;
    }
    try {
      entry.delete();
    } catch {
      // Already gone.
    }
  }
}

// --- Ledger: highest photo number ever queued per date/SKU ------------------

type Ledger = Record<string, number>;

function ledgerKey(dateRoot: string, sku: string) {
  return `${dateRoot}/${sku}`;
}

function readLedger(): Ledger {
  try {
    if (LEDGER_FILE.exists) {
      return JSON.parse(LEDGER_FILE.textSync()) as Ledger;
    }
  } catch (error) {
    console.warn('Could not read upload ledger:', error);
  }
  return {};
}

export function getLedgerMax(dateRoot: string, sku: string): number {
  return readLedger()[ledgerKey(dateRoot, sku)] ?? 0;
}

export function recordLedgerMax(dateRoot: string, sku: string, maxNumber: number) {
  ensureRoot();
  const ledger = readLedger();
  const key = ledgerKey(dateRoot, sku);
  if ((ledger[key] ?? 0) >= maxNumber) {
    return;
  }
  ledger[key] = maxNumber;
  // Keep only the last couple of weeks of dates so it can't grow forever.
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const k of Object.keys(ledger)) {
    if (k.slice(0, 10) < cutoff) {
      delete ledger[k];
    }
  }
  if (!LEDGER_FILE.exists) {
    LEDGER_FILE.create();
  }
  LEDGER_FILE.write(JSON.stringify(ledger));
}

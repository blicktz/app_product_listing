import Constants from 'expo-constants';
import type { File } from 'expo-file-system';
import { call, macAuthHeaders } from '../pick/api';
import { getSnapshot as getPickSnapshot, type UploadDestination } from '../pick/store';
import { checkSku, presignUpload, type CheckSkuResult } from '../uploadApi';
import type { UploadJob } from './store';

// Where a job's files go: the Mac Studio (same server, address and token as
// Pick and Stow) or R2 through the Cloudflare Worker. The runner only sees the
// outcomes below, so the retry and conflict rules stay in one place.

export type SendOutcome =
  | { kind: 'ok' }
  /** Worth another attempt. */
  | { kind: 'retry'; message: string }
  /** The Mac answered but its photo drive isn't mounted: wait, using no attempt. */
  | { kind: 'drive-offline'; message: string }
  /** A different file already has this name. */
  | { kind: 'conflict'; message: string }
  /** Refused for good; retrying can't help. */
  | { kind: 'rejected'; message: string; httpStatus: number }
  /** Bad token: needs a person. */
  | { kind: 'unauthorized'; message: string };

export type SendFile = (filename: string, contentType: string, file: File) => Promise<SendOutcome>;

const UPLOAD_TIMEOUT_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 10_000;

// Same rule as the Worker's and the Mac's path validation.
const UPLOAD_SKU_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidUploadSku(sku: string): boolean {
  return UPLOAD_SKU_PATTERN.test(sku);
}

/** The destination's name for sentences like "not reached the Mac". */
export function destinationName(destination: UploadDestination): string {
  return destination === 'mac' ? 'the Mac' : 'R2';
}

function macBaseUrl(): string {
  const base = getPickSnapshot().serverUrl.replace(/\/+$/, '');
  if (!base) {
    throw new Error('Mac server URL is not set.');
  }
  return base;
}

/** Headers must be ASCII, and device names often have a curly apostrophe. */
function asciiHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?');
}

async function uploadWithTimeout(
  file: File,
  url: string,
  options: Parameters<File['upload']>[1]
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    return await file.upload(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// --- Number lookup ---------------------------------------------------------------

export function lookupNumbers(
  destination: UploadDestination,
  date: string,
  sku: string
): Promise<CheckSkuResult> {
  if (destination === 'r2') {
    return checkSku(date, sku);
  }
  const params = new URLSearchParams({ date, sku });
  return call<CheckSkuResult>(
    getPickSnapshot().serverUrl,
    `/shoot/sku?${params.toString()}`,
    LOOKUP_TIMEOUT_MS
  );
}

// --- Sending ---------------------------------------------------------------------

function macOutcome(status: number, filename: string, body: string): SendOutcome {
  if (status >= 200 && status < 300) {
    return { kind: 'ok' };
  }
  switch (status) {
    case 401:
      return { kind: 'unauthorized', message: 'The Mac refused this phone. Check the Mac token.' };
    case 409:
      return { kind: 'conflict', message: `The Mac already has a different ${filename}.` };
    case 400:
    case 413:
      return {
        kind: 'rejected',
        httpStatus: status,
        message: `The Mac refused ${filename} (${status}). ${body}`.trim(),
      };
    case 503:
      return { kind: 'drive-offline', message: 'Mac drive offline' };
    default:
      return { kind: 'retry', message: `Upload failed for ${filename} (${status})` };
  }
}

function macSender(job: UploadJob): SendFile {
  const base = macBaseUrl();
  const device = asciiHeaderValue(Constants.deviceName ?? 'iPhone');
  const folder = `${encodeURIComponent(job.dateRoot)}/${encodeURIComponent(job.sku)}`;

  return async (filename, contentType, file) => {
    const md5 = file.info({ md5: true }).md5;
    if (!md5) {
      throw new Error(`Could not read ${filename} on this phone`);
    }
    const { status, body } = await uploadWithTimeout(
      file,
      `${base}/shoot/files/${folder}/${encodeURIComponent(filename)}`,
      {
        httpMethod: 'PUT',
        mimeType: contentType,
        headers: {
          ...macAuthHeaders(),
          'Content-Type': contentType,
          'X-Content-MD5': md5,
          'X-Shoot-Session': asciiHeaderValue(job.id),
          'X-Shoot-Device': device,
        },
        // The phone stays unlocked while shooting. If the app leaves the
        // foreground the file fails and the queue resends it on return.
        sessionType: 'foreground',
      }
    );
    return macOutcome(status, filename, body);
  };
}

async function r2Sender(job: UploadJob, filenames: string[]): Promise<SendFile> {
  const { uploadUrls } = await presignUpload(job.dateRoot, job.sku, filenames);
  return async (filename, contentType, file) => {
    const url = uploadUrls[filename];
    if (!url) {
      throw new Error(`No upload URL returned for ${filename}`);
    }
    // Streams from disk; the iOS background session keeps going if the app is
    // suspended mid-transfer.
    const { status } = await uploadWithTimeout(file, url, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': contentType },
      mimeType: contentType,
      sessionType: 'background',
    });
    if (status >= 200 && status < 300) {
      return { kind: 'ok' };
    }
    // 403 is usually an expired presign; the next pass presigns again.
    return { kind: 'retry', message: `Upload failed for ${filename} (${status})` };
  };
}

/** Throws if the destination can't be prepared; the job then uses an attempt. */
export async function prepareSender(
  destination: UploadDestination,
  job: UploadJob,
  filenames: string[]
): Promise<SendFile> {
  return destination === 'mac' ? macSender(job) : r2Sender(job, filenames);
}

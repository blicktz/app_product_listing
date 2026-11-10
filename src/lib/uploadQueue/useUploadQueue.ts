import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type QueueSnapshot } from './runner';
import { photoFilename, type UploadJob, type WaitReason } from './store';

export function useUploadQueue(): QueueSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export type QueueSummary = {
  /** Jobs still being prepared/uploaded or due for a retry. */
  active: number;
  /** Jobs parked offline or between retries. */
  waiting: number;
  /** Jobs that need the user: retries exhausted, a numbering conflict, or refused for good. */
  attention: number;
};

export function needsAttention(job: UploadJob): boolean {
  return job.status === 'failed' || job.status === 'conflict' || job.status === 'rejected';
}

/** Photos on this phone that haven't reached their destination. */
export function waitingPhotoCount(jobs: UploadJob[]): number {
  let count = 0;
  for (const job of jobs) {
    if (job.status !== 'done') {
      count += job.photos.filter((p) => !job.uploaded.includes(photoFilename(job.sku, p.number))).length;
    }
  }
  return count;
}

/** What the queue is stuck behind, worst first; null if nothing is parked. */
export function queueWaitReason(jobs: UploadJob[]): WaitReason | null {
  const reasons = new Set(jobs.filter((j) => j.status !== 'done').map((j) => j.waitReason));
  return (['drive', 'mac', 'network'] as const).find((reason) => reasons.has(reason)) ?? null;
}

export function summarize(jobs: UploadJob[]): QueueSummary {
  const summary: QueueSummary = { active: 0, waiting: 0, attention: 0 };
  for (const job of jobs) {
    if (needsAttention(job)) {
      summary.attention++;
    } else if (job.status === 'waiting-retry') {
      summary.waiting++;
    } else if (job.status !== 'done') {
      summary.active++;
    }
  }
  return summary;
}

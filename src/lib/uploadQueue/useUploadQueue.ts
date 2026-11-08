import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type QueueSnapshot } from './runner';
import type { UploadJob } from './store';

export function useUploadQueue(): QueueSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export type QueueSummary = {
  /** Jobs still being prepared/uploaded or due for a retry. */
  active: number;
  /** Jobs parked offline or between retries. */
  waiting: number;
  /** Jobs that need the user: retries exhausted, or a numbering conflict. */
  attention: number;
};

export function summarize(jobs: UploadJob[]): QueueSummary {
  const summary: QueueSummary = { active: 0, waiting: 0, attention: 0 };
  for (const job of jobs) {
    if (job.status === 'failed' || job.status === 'conflict') {
      summary.attention++;
    } else if (job.status === 'waiting-retry') {
      summary.waiting++;
    } else if (job.status !== 'done') {
      summary.active++;
    }
  }
  return summary;
}

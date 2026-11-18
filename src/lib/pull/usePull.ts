import { useMemo, useSyncExternalStore } from 'react';
import { deriveLines, groupBoxes } from './derive';
import { getSnapshot, pullBlock, subscribe } from './store';

export function usePullSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The pull list with the server's answers applied, its boxes, and why pulling is off (if it is). */
export function usePullData() {
  const snap = usePullSnapshot();
  const states = useMemo(() => deriveLines(snap.list?.lines ?? [], snap.updates), [snap.list, snap.updates]);
  const boxes = useMemo(() => groupBoxes(states.values()), [states]);
  const block = pullBlock(snap);
  return { snap, states, boxes, block, busy: snap.pending !== null };
}

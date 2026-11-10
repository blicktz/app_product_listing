import { useMemo, useSyncExternalStore } from 'react';
import { deriveLineStates, groupBoxes } from './derive';
import { getSnapshot, subscribe } from './store';

export function usePickSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The pick list with this phone's picks applied, plus its boxes. */
export function usePickData() {
  const snap = usePickSnapshot();
  const states = useMemo(
    () => deriveLineStates(snap.list?.lines ?? [], snap.events, snap.fetchStartedAt),
    [snap.list, snap.events, snap.fetchStartedAt]
  );
  const boxes = useMemo(() => groupBoxes(states.values()), [states]);
  return { snap, states, boxes };
}

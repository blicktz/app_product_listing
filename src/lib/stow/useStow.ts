import { useMemo, useSyncExternalStore } from 'react';
import { deriveSessions, isExistingBox, openSessionId } from './derive';
import { getSnapshot, subscribe } from './store';

/** This phone's stow sessions, plus the one in progress. */
export function useStowData() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const sessions = useMemo(() => deriveSessions(snap.events), [snap.events]);
  const openId = useMemo(() => openSessionId(snap.events), [snap.events]);
  const current = sessions.find((s) => s.id === openId) ?? null;
  const openBoxExisting = current?.openBox
    ? isExistingBox(current.openBox, snap.server, snap.events, current.id)
    : null;
  return { snap, sessions, current, openBoxExisting };
}

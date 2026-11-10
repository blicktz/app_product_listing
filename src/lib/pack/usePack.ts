import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';

export function usePackData() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

import { call } from '../pick/api';
import type { StowEvent, StowServerState } from './types';

// Stow endpoints on the same Mac portal, base URL and token as Pick.

const STATE_TIMEOUT_MS = 20_000;
const EVENTS_TIMEOUT_MS = 15_000;

export function fetchStowState(baseUrl: string): Promise<StowServerState> {
  return call<StowServerState>(baseUrl, '/stow-state', STATE_TIMEOUT_MS);
}

export function postStowEvents(
  baseUrl: string,
  device: string,
  installId: string,
  events: StowEvent[]
): Promise<{ accepted: string[] }> {
  return call<{ accepted: string[] }>(baseUrl, '/stow-events', EVENTS_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, install_id: installId, events }),
  });
}

import { call } from '../pick/api';
import type { ShootEvent, ShootServerState } from './types';

// Shoot log endpoints on the same Mac portal, base URL and token as Pick.

const STATE_TIMEOUT_MS = 10_000;
const EVENTS_TIMEOUT_MS = 15_000;

export const RECENT_DAYS = 7;

export function fetchShootState(baseUrl: string): Promise<ShootServerState> {
  return call<ShootServerState>(baseUrl, `/shoot-state?days=${RECENT_DAYS}`, STATE_TIMEOUT_MS);
}

export function postShootEvents(
  baseUrl: string,
  device: string,
  installId: string,
  appVersion: string | null,
  events: ShootEvent[]
): Promise<{ accepted: string[] }> {
  return call<{ accepted: string[] }>(baseUrl, '/shoot-events', EVENTS_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, install_id: installId, app_version: appVersion, events }),
  });
}

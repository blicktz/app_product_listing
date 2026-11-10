import { call } from '../pick/api';
import type { PackEvent, PackEventsResponse, PackServerState } from './types';

// Pack endpoints on the same Mac portal, base URL and token as Pick.

// Load labels calls eBay and Shopify on the Mac; the server answers within
// ~110 s and keeps loading in the background if it needs longer.
const LOAD_TIMEOUT_MS = 120_000;
const QUICK_TIMEOUT_MS = 20_000;
const EVENTS_TIMEOUT_MS = 15_000;

export const DEFAULT_LOAD_HOURS = 24;

/** load=true fetches the labels bought in the last `hours` first (slow); false reads the DB. */
export function fetchPackState(
  baseUrl: string,
  load: boolean,
  hours = DEFAULT_LOAD_HOURS,
  timeoutMs?: number
): Promise<PackServerState> {
  return call<PackServerState>(
    baseUrl,
    `/pack-state?load=${load ? 1 : 0}&hours=${hours}`,
    timeoutMs ?? (load ? LOAD_TIMEOUT_MS : QUICK_TIMEOUT_MS)
  );
}

export function postPackEvents(
  baseUrl: string,
  device: string,
  installId: string,
  events: PackEvent[]
): Promise<PackEventsResponse> {
  return call<PackEventsResponse>(baseUrl, '/pack-events', EVENTS_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, install_id: installId, events }),
  });
}

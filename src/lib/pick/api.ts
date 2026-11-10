import type { PickEvent, PickList } from './types';

// Client for the eBay analytics portal running on the Mac Studio, reached over
// the home Wi-Fi (plain HTTP, Bonjour `.local` name). Separate from the
// Cloudflare Worker client in ../uploadApi.ts.

export const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_PICK_SERVER_URL ?? '';
const TOKEN = process.env.EXPO_PUBLIC_PICK_TOKEN ?? '';

const HEALTH_TIMEOUT_MS = 5_000;
// A full pick list re-syncs eBay and Shopify first (make force-resync).
const PICK_LIST_TIMEOUT_MS = 120_000;
const QUICK_PICK_LIST_TIMEOUT_MS = 20_000;
const EVENTS_TIMEOUT_MS = 15_000;

export const LOOKBACK_DAYS = 7;

async function call<T>(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  init: RequestInit = {}
): Promise<T> {
  if (!baseUrl) {
    throw new Error('Mac server URL is not set.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Mac server error (${response.status}) ${detail}`.trim());
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Mac server did not answer in time.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const result = await call<{ ok?: boolean }>(baseUrl, '/health', HEALTH_TIMEOUT_MS);
    return result.ok === true;
  } catch {
    return false;
  }
}

/** resync=true runs the eBay/Shopify re-sync first (slow); false returns the DB as is. */
export function fetchPickList(baseUrl: string, resync: boolean): Promise<PickList> {
  const params = `lookback_days=${LOOKBACK_DAYS}&resync=${resync ? 1 : 0}`;
  return call<PickList>(
    baseUrl,
    `/pick-list?${params}`,
    resync ? PICK_LIST_TIMEOUT_MS : QUICK_PICK_LIST_TIMEOUT_MS
  );
}

export function postPickEvents(
  baseUrl: string,
  device: string,
  events: PickEvent[]
): Promise<{ accepted: string[] }> {
  return call<{ accepted: string[] }>(baseUrl, '/pick-events', EVENTS_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, events }),
  });
}

import { MacServerError, call } from '../pick/api';
import type { OrdersSync, PullEvent, PullEventReply, PullList } from './types';

// Pull endpoints on the Mac portal. Same server, address and token as Pick
// (pick/api.ts), but its own endpoints: GET /pull-list, POST /pull-event.

const HEALTH_TIMEOUT_MS = 5_000;
// The Mac syncs orders before it builds the list, like Pick's full re-sync.
const PULL_LIST_TIMEOUT_MS = 120_000;
const EVENT_TIMEOUT_MS = 15_000;

/** The Mac refused to build a list because its order sync failed (§5.2). */
export class OrdersNotSyncedError extends Error {
  constructor() {
    super('Orders couldn’t be synced on the Mac.');
    this.name = 'OrdersNotSyncedError';
  }
}

export type Health = { ok: boolean; ordersSync: OrdersSync | null };

export async function fetchHealth(baseUrl: string): Promise<Health> {
  try {
    const result = await call<{ ok?: boolean; orders_sync?: OrdersSync }>(baseUrl, '/health', HEALTH_TIMEOUT_MS);
    return { ok: result.ok === true, ordersSync: result.orders_sync ?? null };
  } catch {
    return { ok: false, ordersSync: null };
  }
}

export async function fetchPullList(baseUrl: string): Promise<PullList> {
  let result: PullList & { error?: string; reason?: string };
  try {
    result = await call<PullList & { error?: string; reason?: string }>(baseUrl, '/pull-list', PULL_LIST_TIMEOUT_MS);
  } catch (error) {
    // The code may come back as an error status with the code in the body.
    if (error instanceof MacServerError && error.message.includes('orders_not_synced')) {
      throw new OrdersNotSyncedError();
    }
    throw error;
  }
  if (result.error === 'orders_not_synced' || result.reason === 'orders_not_synced') {
    throw new OrdersNotSyncedError();
  }
  return result;
}

/** One event per request; a reject is a normal answer (HTTP 200, accepted: false). */
export function postPullEvent(baseUrl: string, device: string, event: PullEvent): Promise<PullEventReply> {
  return call<PullEventReply>(baseUrl, '/pull-event', EVENT_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, event }),
  });
}

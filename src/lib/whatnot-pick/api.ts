import { call } from '../pick/api';
import type { EventsReply, ShowIndex, WhatnotEvent, WhatnotPlan } from './types';

// The plan is read straight from the Mac's DB (no eBay/Shopify re-sync), so
// these are quick calls.
const LIST_TIMEOUT_MS = 20_000;
const EVENTS_TIMEOUT_MS = 15_000;

export function fetchShows(baseUrl: string): Promise<ShowIndex> {
  return call<ShowIndex>(baseUrl, '/whatnot-shows', LIST_TIMEOUT_MS);
}

export function fetchPlan(baseUrl: string, planId: number): Promise<WhatnotPlan> {
  return call<WhatnotPlan>(baseUrl, `/whatnot-pick?plan_id=${planId}`, LIST_TIMEOUT_MS);
}

export function postWhatnotEvents(baseUrl: string, device: string, events: WhatnotEvent[]): Promise<EventsReply> {
  return call<EventsReply>(baseUrl, '/whatnot-pick-events', EVENTS_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, events }),
  });
}

// make test (node --test): the thank-you card reminder follows the server's insert_card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveBoard } from './derive.ts';
import type { PackPackage } from './types.ts';

function pkg(key: string, extra: Partial<PackPackage> = {}, cancelled = false): PackPackage {
  return {
    key, name: key, store: 'shopify', buyer: 'Jane', ship_city: null, ship_state: null,
    tracking: `T${key}`, tracking_norm: `T${key}`, carrier: 'USPS', label_time: null, label_count: 1,
    orders: [{ order_key: key, store: 'shopify', order_id: key, name: key, cancelled, packed_at: null }],
    items: [], scans: [], ...extra,
  };
}

test('insertCard is set from insert_card, never on a cancelled package, and false for an old server', () => {
  const board = deriveBoard(
    [pkg('shopify:1', { insert_card: true }), pkg('shopify:2', { insert_card: false }),
     pkg('shopify:3', { insert_card: true }, true), pkg('shopify:4')],
    [], null,
  );
  const card = Object.fromEntries(board.packages.map((p) => [p.key, p.insertCard]));
  assert.deepEqual(card, { 'shopify:1': true, 'shopify:2': false, 'shopify:3': false, 'shopify:4': false });
});

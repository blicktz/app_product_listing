// make test (node --test): a range-label scan as Stow records it, grouped and undone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveLocations, deriveSessions, groupRows } from './derive.ts';
import type { LocalStowEvent, StowEvent } from './types.ts';

let seq = 0;
function ev(action: StowEvent['action'], extra: Partial<StowEvent> = {}): LocalStowEvent {
  seq += 1;
  return {
    acceptedAt: null,
    event: {
      event_id: `e${seq}`, session_id: 's1', seq, action, box_label: null, sku: null, units: null,
      moved_from_box: null, undoes_event_id: null, method: 'scan', scanned_value: null, note: null,
      at: `2026-11-22T10:00:${String(seq).padStart(2, '0')}Z`, ...extra,
    },
  };
}

const BOX = 'ST-GAR-CRD-001';
const OLD = 'ST-GAR-AAA-004';
const CODE = 'AAQ1122001~005';
const SKUS = ['AAQ-1122-001', 'AAQ-1122-002', 'AAQ-1122-003', 'AAQ-1122-004', 'AAQ-1122-005'];

test('a range scan is one group; undo of its rows restores every SKU', () => {
  seq = 0;
  const server = {
    generated_at: '', boxes: [],
    locations: [{ sku: 'AAQ-1122-004', box_label: OLD, units: 2, previous_box: null }],
  };
  const events = [ev('box_open', { box_label: BOX }), ev('stow', { box_label: BOX, sku: 'X-1122-001', units: 1 })];
  SKUS.forEach((sku, i) => {
    const local = ev('stow', {
      box_label: BOX, sku, units: 1, scanned_value: CODE, note: `range ${i + 1}/5`,
      moved_from_box: sku === 'AAQ-1122-004' ? OLD : null,
    });
    if (sku === 'AAQ-1122-004') local.movedUnits = 2;
    events.push(local);
  });

  const box = deriveSessions(events)[0].boxes[0];
  const items = groupRows(box.rows);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'range');
  if (items[0].kind !== 'range') return;
  assert.deepEqual(items[0].rows.map((r) => r.sku), SKUS);
  assert.equal(items[0].moved, 1);
  assert.equal(items[0].units, 5);
  assert.equal(items[1].kind, 'single');
  assert.equal(deriveSessions(events)[0].skus, 6);
  assert.equal(deriveLocations(server, events, null).get('AAQ-1122-004')?.box, BOX);

  // ↶ on the group: one undo per row, newest first
  const undos = [...items[0].rows]
    .sort((a, b) => b.scanSeq - a.scanSeq)
    .map((r) => ev('undo', { box_label: BOX, sku: r.sku, units: r.units, undoes_event_id: r.lastEventId, method: 'manual' }));
  const after = [...events, ...undos];
  const rows = deriveSessions(after)[0].boxes[0].rows;
  assert.deepEqual(rows.map((r) => r.sku), ['X-1122-001']);
  const loc = deriveLocations(server, after, null);
  assert.deepEqual(loc.get('AAQ-1122-004'), { box: OLD, units: 2, previous: null });
  assert.equal(loc.has('AAQ-1122-001'), false);
});

test('two scans of the same code are two groups', () => {
  seq = 0;
  const one = (i: number, sku: string, n: number) =>
    ev('stow', { box_label: BOX, sku, units: 1, scanned_value: CODE, note: `range ${i}/${n}` });
  const events = [ev('box_open', { box_label: BOX }), one(1, SKUS[0], 2), one(2, SKUS[1], 2), one(1, SKUS[2], 1)];
  const items = groupRows(deriveSessions(events)[0].boxes[0].rows);
  assert.deepEqual(items.map((i) => (i.kind === 'range' ? i.rows.length : 0)), [1, 2]);
});

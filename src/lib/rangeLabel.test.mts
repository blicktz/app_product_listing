// make test (node --test). Cases ported from ops_console/tests/test_range_label.py.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeElsewhere, looksLikeRange, parseRangeCode, planRangeStow } from './rangeLabel.ts';

const SKUS = Array.from({ length: 15 }, (_, i) => `AAQ-1122-${String(i + 1).padStart(3, '0')}`);

test('barcode and printed forms expand to the same SKUs', () => {
  const a = parseRangeCode('AAQ1122001~015');
  const b = parseRangeCode('aaq-1122-001~015 ');
  assert.ok(a?.ok && b?.ok);
  assert.deepEqual(a.skus, SKUS);
  assert.deepEqual(b.skus, SKUS);
  assert.equal(b.code, 'AAQ1122001~015');
  assert.equal(a.printed, 'AAQ-1122-001~015');
  const three = parseRangeCode('AAQ1122001~003');
  assert.ok(three?.ok);
  assert.deepEqual(three.skus, ['AAQ-1122-001', 'AAQ-1122-002', 'AAQ-1122-003']);
});

test('a one-number range is one SKU', () => {
  const r = parseRangeCode('AAQ1122007~007');
  assert.ok(r?.ok);
  assert.deepEqual(r.skus, ['AAQ-1122-007']);
});

test('bad ranges are rejected, non-ranges are not ranges', () => {
  assert.equal(parseRangeCode('AAQ-1122-001'), null);
  assert.equal(parseRangeCode('ST-GAR-AAA-001'), null);
  assert.equal(parseRangeCode('AAQ1122009~003')?.ok, false);
  assert.equal(parseRangeCode('AAQ1122001~300')?.ok, false);
  assert.equal(parseRangeCode('AAQ1122001~200')?.ok, true);
  assert.equal(parseRangeCode('AAQ1122~015')?.ok, false);
  assert.ok(looksLikeRange('AAQ1122001~015'));
  assert.ok(!looksLikeRange('AAQ-1122-001'));
});

test('planRangeStow sorts into new, already here and elsewhere', () => {
  const locations = new Map([
    ['AAQ-1122-002', { box: 'ST-GAR-CRD-001', units: 1 }],
    ['AAQ-1122-004', { box: 'ST-GAR-AAA-004', units: 1 }],
    ['AAQ-1122-005', { box: 'ST-GAR-AAA-004', units: 2 }],
    ['AAQ-1122-011', { box: 'ST-OFF-BBB-002', units: null }],
  ]);
  const plan = planRangeStow(SKUS, 'ST-GAR-CRD-001', locations);
  assert.equal(plan.fresh.length, 11);
  assert.deepEqual(plan.here, ['AAQ-1122-002']);
  assert.deepEqual(
    plan.elsewhere.map((e) => e.sku),
    ['AAQ-1122-004', 'AAQ-1122-005', 'AAQ-1122-011']
  );
  assert.equal(
    describeElsewhere(plan.elsewhere),
    'AAQ-1122-004, -005 in ST-GAR-AAA-004 · AAQ-1122-011 in ST-OFF-BBB-002'
  );
  const all = planRangeStow(SKUS, 'ST-GAR-ZZZ-001', new Map(SKUS.map((s) => [s, { box: 'ST-GAR-CRD-001', units: 1 }])));
  assert.equal(describeElsewhere(all.elsewhere), 'AAQ-1122-001 … -015 (15) in ST-GAR-CRD-001');
});

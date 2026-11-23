// Range labels: one label for a batch of consecutive card SKUs, printed by the
// ops console Cards tab (ops_console/range_label.py). Only Stow accepts them;
// every other scanner rejects them. Spec: fp_ops/docs/stow-range-label-requirements.md
//
//   barcode  AAQ1122001~015    (Code 128, no dashes so the bars fit the label)
//   printed  AAQ-1122-001~015  (also accepted when typed)
//   SKUs     AAQ-1122-001 … AAQ-1122-015
//
// No imports, so `make test` can run its tests with plain Node.

const BARCODE = /^([A-Z]+)(\d{4})(\d{3})~(\d{3})$/;
const PRINTED = /^([A-Z]+)-(\d{4})-(\d{3})~(\d{3})$/;

/** No real batch is this big: a bigger range is a misread or a bad label. */
export const MAX_RANGE_SKUS = 200;

export const RANGE_STOW_ONLY = 'Range labels are for Stow only';
export const RANGE_STOW_ONLY_DETAIL = "Scan the card's own SKU.";

export type RangeCode =
  | { ok: true; code: string; printed: string; skus: string[] }
  | { ok: false; code: string; reason: string };

/** A '~' never appears in a SKU or a box label, so anything with one is meant as a range. */
export function looksLikeRange(code: string): boolean {
  return code.includes('~');
}

const pad = (n: number) => String(n).padStart(3, '0');

/** Parses a range in either form; null when it isn't range-shaped at all. */
export function parseRangeCode(raw: string): RangeCode | null {
  const text = raw.trim().toUpperCase();
  if (!looksLikeRange(text)) {
    return null;
  }
  const m = BARCODE.exec(text) ?? PRINTED.exec(text);
  if (!m) {
    return { ok: false, code: text, reason: 'not a range label' };
  }
  const [, prefix, mmdd] = m;
  const first = Number(m[3]);
  const last = Number(m[4]);
  if (last < first) {
    return { ok: false, code: text, reason: 'the last number is before the first' };
  }
  if (last - first + 1 > MAX_RANGE_SKUS) {
    return { ok: false, code: text, reason: `more than ${MAX_RANGE_SKUS} SKUs` };
  }
  const skus: string[] = [];
  for (let n = first; n <= last; n++) {
    skus.push(`${prefix}-${mmdd}-${pad(n)}`);
  }
  return {
    ok: true,
    code: `${prefix}${mmdd}${pad(first)}~${pad(last)}`,
    printed: `${prefix}-${mmdd}-${pad(first)}~${pad(last)}`,
    skus,
  };
}

export type RangeLocation = { box: string; units: number | null };

export type RangePlan = {
  /** No location yet: stowed into the open box. */
  fresh: string[];
  /** Already in the open box: skipped (a range never adds a unit). */
  here: string[];
  /** In another box: moved only after a confirmation. */
  elsewhere: { sku: string; box: string; units: number | null }[];
};

/** Sorts a range's SKUs by where they are now (`locations`: SKU → current box). */
export function planRangeStow(
  skus: string[],
  openBox: string,
  locations: Map<string, RangeLocation>
): RangePlan {
  const plan: RangePlan = { fresh: [], here: [], elsewhere: [] };
  for (const sku of skus) {
    const known = locations.get(sku);
    if (!known) {
      plan.fresh.push(sku);
    } else if (known.box === openBox) {
      plan.here.push(sku);
    } else {
      plan.elsewhere.push({ sku, box: known.box, units: known.units });
    }
  }
  return plan;
}

/** "AAQ-1122-004, -005 in ST-GAR-AAA-004 · AAQ-1122-011 in ST-OFF-BBB-002" */
export function describeElsewhere(elsewhere: RangePlan['elsewhere'], maxBoxes = 4): string {
  const byBox = new Map<string, string[]>();
  for (const { sku, box } of elsewhere) {
    byBox.set(box, [...(byBox.get(box) ?? []), sku]);
  }
  const num = (sku: string) => `-${sku.slice(sku.lastIndexOf('-') + 1)}`;
  const parts = [...byBox].map(([box, skus]) => {
    const names =
      skus.length <= 4
        ? skus.map((s, i) => (i === 0 ? s : num(s))).join(', ')
        : `${skus[0]} … ${num(skus[skus.length - 1])} (${skus.length})`;
    return `${names} in ${box}`;
  });
  const more = parts.length - maxBoxes;
  return more > 0 ? `${parts.slice(0, maxBoxes).join(' · ')} · ${more} more boxes` : parts.join(' · ');
}

import { isStorageLabel } from '../pick/boxLabel';
import { SKU_PATTERN } from '../pick/scan';
import { parseRangeCode } from '../rangeLabel';
import type { StowServerState } from './types';

// Decides what a scan means. Pure, so the screens only render the outcome.
// Stricter than Pick: there is no list to catch a misread, so text that is
// neither a box label nor a SKU is rejected instead of being treated as a box.

export type StowScan =
  | { kind: 'box'; label: string }
  | { kind: 'sku'; sku: string }
  /** A range label (AAQ1122001~015): every SKU of the batch. `code` is the barcode form. */
  | { kind: 'range'; code: string; printed: string; skus: string[] }
  | { kind: 'bad-range'; code: string; reason: string }
  | { kind: 'invalid' };

/** Old short box ID → printed label, for the boxes the server knows. */
export function oldBoxIndex(state: StowServerState | null): Map<string, string> {
  const index = new Map<string, string>();
  for (const box of state?.boxes ?? []) {
    if (box.label) {
      index.set(box.box_id.toUpperCase(), box.label);
    }
  }
  return index;
}

export function classifyStowScan(code: string, oldBoxes: Map<string, string>): StowScan {
  // Before everything else: a range must never be read as a box or a SKU.
  const range = parseRangeCode(code);
  if (range) {
    return range.ok
      ? { kind: 'range', code: range.code, printed: range.printed, skus: range.skus }
      : { kind: 'bad-range', code: range.code, reason: range.reason };
  }
  if (isStorageLabel(code)) {
    return { kind: 'box', label: code };
  }
  const label = oldBoxes.get(code);
  if (label) {
    return { kind: 'box', label };
  }
  return SKU_PATTERN.test(code) ? { kind: 'sku', sku: code } : { kind: 'invalid' };
}

import { isStorageLabel } from '../pick/boxLabel';
import { SKU_PATTERN } from '../pick/scan';
import type { StowServerState } from './types';

// Decides what a scan means. Pure, so the screens only render the outcome.
// Stricter than Pick: there is no list to catch a misread, so text that is
// neither a box label nor a SKU is rejected instead of being treated as a box.

export type StowScan = { kind: 'box'; label: string } | { kind: 'sku'; sku: string } | { kind: 'invalid' };

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
  if (isStorageLabel(code)) {
    return { kind: 'box', label: code };
  }
  const label = oldBoxes.get(code);
  if (label) {
    return { kind: 'box', label };
  }
  return SKU_PATTERN.test(code) ? { kind: 'sku', sku: code } : { kind: 'invalid' };
}

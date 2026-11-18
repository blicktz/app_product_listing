import { isStorageLabel, sameBoxLabel } from '../pick/boxLabel';
import { SKU_PATTERN } from '../pick/scan';
import type { PullLineState } from './derive';

// Decides what a scan means on a Pull screen. Pure. It only ever looks at pull
// lines: a Pick line can't match here.

export type ScanKind = 'box' | 'item';

export function classifyScan(code: string, states: Iterable<PullLineState>, knownBoxes: Set<string>): ScanKind {
  for (const state of states) {
    if (state.sku.toUpperCase() === code) {
      return 'item';
    }
  }
  if (isStorageLabel(code) || knownBoxes.has(code)) {
    return 'box';
  }
  return SKU_PATTERN.test(code) ? 'item' : 'box';
}

export type ItemScanResult =
  | { kind: 'pull'; state: PullLineState; boxId: string | null }
  | { kind: 'other-box'; state: PullLineState; listedIn: string | null }
  | { kind: 'already-done'; state: PullLineState }
  | { kind: 'not-on-list' };

function inBox(state: PullLineState, boxId: string): boolean {
  return [state.box_id, ...(state.other_boxes ?? [])].some((listed) => listed !== null && sameBoxLabel(listed, boxId));
}

/**
 * @param boxId the box open on screen, or null (Pull home, Can't find).
 * @param preferLineKey the line the screen is about (Can't find, image viewer).
 */
export function resolveItemScan(
  code: string,
  states: Iterable<PullLineState>,
  boxId: string | null,
  preferLineKey: string | null = null
): ItemScanResult {
  // One line per SKU, so at most one match.
  const state = [...states].find((s) => s.sku.toUpperCase() === code);
  if (!state) {
    return { kind: 'not-on-list' };
  }
  if (state.complete) {
    return { kind: 'already-done', state };
  }
  if (boxId) {
    return inBox(state, boxId) ? { kind: 'pull', state, boxId } : { kind: 'other-box', state, listedIn: state.box_id };
  }
  // No box open: an unlocated item, or the item a Can't find screen is about.
  if (!state.box_id || state.line_key === preferLineKey) {
    return { kind: 'pull', state, boxId: null };
  }
  return { kind: 'other-box', state, listedIn: state.box_id };
}

import { isDone, labelSku, type LineState } from './derive';

// Decides what a scan means. Pure, so the screens only render the outcome.

export function normalizeScan(raw: string): string {
  return raw.replace(/[\r\n\t]/g, '').trim().toUpperCase();
}

// PREFIX-MMDD-NNN, plus the legacy forms inventory_sync.parse_sku accepts.
const SKU_PATTERN = /^[A-Z]+-?\d{4}-?\d+$/;

export type ScanKind = 'box' | 'item';

export function classifyScan(
  code: string,
  states: Iterable<LineState>,
  knownBoxes: Set<string>
): ScanKind {
  for (const state of states) {
    if (labelSku(state.line.sku) === code) {
      return 'item';
    }
  }
  if (knownBoxes.has(code)) {
    return 'box';
  }
  // Box labels are short (AAC-3, FRE-001); anything shaped like a SKU is an item.
  return SKU_PATTERN.test(code) ? 'item' : 'box';
}

export type ItemScanResult =
  /** Record a pick of `state` from `boxId`. */
  | { kind: 'pick'; state: LineState; boxId: string | null }
  /** On the list, but listed in another box than the one open. */
  | { kind: 'other-box'; state: LineState; listedIn: string | null; boxId: string | null }
  | { kind: 'already-picked'; code: string }
  | { kind: 'not-on-list'; code: string };

function inBox(state: LineState, boxId: string): boolean {
  return state.line.box_id === boxId || (state.line.other_boxes ?? []).includes(boxId);
}

/**
 * @param boxId the box open on screen, or null (Pick home, Can't find).
 * @param preferLineKey the line the screen is about (Can't find, image viewer).
 */
export function resolveItemScan(
  code: string,
  states: Iterable<LineState>,
  boxId: string | null,
  preferLineKey: string | null = null
): ItemScanResult {
  const matches = [...states].filter((s) => labelSku(s.line.sku) === code);
  const open = matches
    .filter((s) => !isDone(s) || s.status === 'missing')
    .sort((a, b) => {
      // The line on screen first, then open before missing, then oldest order.
      const preferred = Number(b.line.line_key === preferLineKey) - Number(a.line.line_key === preferLineKey);
      if (preferred !== 0) {
        return preferred;
      }
      const missing = Number(a.status === 'missing') - Number(b.status === 'missing');
      return missing !== 0 ? missing : a.line.order_date.localeCompare(b.line.order_date);
    });

  if (open.length === 0) {
    return matches.length > 0 ? { kind: 'already-picked', code } : { kind: 'not-on-list', code };
  }

  if (boxId) {
    const here = open.find((s) => inBox(s, boxId));
    if (here) {
      return { kind: 'pick', state: here, boxId };
    }
    return { kind: 'other-box', state: open[0], listedIn: open[0].line.box_id, boxId };
  }

  // No box open: an unlocated item, or the item a Can't find screen is about,
  // is recorded as found without a box.
  const target = open[0];
  if (!target.line.box_id || target.line.line_key === preferLineKey) {
    return { kind: 'pick', state: target, boxId: null };
  }
  return { kind: 'other-box', state: target, listedIn: target.line.box_id, boxId: null };
}

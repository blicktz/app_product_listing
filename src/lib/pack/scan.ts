import { itemsMatching, normalize, undoTarget, type Board, type PackageState } from './derive';
import type { PackEventKind, PackResult } from './types';

// What a scan, a hand confirm, Mark packed or Undo means. Pure, and a port of
// ops_console/packing.py (handle_scan, confirm_manual, mark_packed, undo_last):
// decide*() says what to record; outcome() words the result from the board as
// it is after recording, so "complete" is seen the moment it happens.

export type RecordSpec = {
  kind: PackEventKind;
  result: PackResult;
  packageKey: string | null;
  orderKeys: string[];
  sku: string | null;
  raw: string | null;
  undoes?: string[];
};

export type Decision =
  | { type: 'label'; pkg: PackageState; left: PackageState | null; record: RecordSpec }
  | { type: 'count'; pkg: PackageState; sku: string; viaOther: boolean; record: RecordSpec }
  | { type: 'dup-open'; pkg: PackageState; sku: string; record: RecordSpec }
  | { type: 'wrong'; pkg: PackageState; sku: string; needing: PackageState[]; record: RecordSpec }
  | { type: 'ambiguous'; sku: string; needing: PackageState[]; record: RecordSpec }
  | { type: 'dup-elsewhere'; pkg: PackageState; sku: string; record: RecordSpec }
  | { type: 'unknown'; code: string; record: RecordSpec }
  | { type: 'manual'; pkg: PackageState; sku: string; record: RecordSpec }
  | { type: 'mark'; pkg: PackageState; record: RecordSpec }
  | { type: 'undo'; pkg: PackageState; what: string; record: RecordSpec }
  /** Nothing is recorded. */
  | { type: 'noop'; pkg: PackageState | null; tone: 'warning'; title: string };

export type Outcome = {
  tone: 'success' | 'warning' | 'error';
  sound: 'ok' | 'done' | 'warn' | 'error';
  title: string;
  detail?: string;
  /** Package to show afterwards; null keeps the current screen. */
  openKey: string | null;
  /** This action completed the package. */
  done: boolean;
};

const MIN_LABEL = 8;
const MIN_TAIL = 10;

function labelHit(trackingNorm: string | null, scanNorm: string): boolean {
  const t = trackingNorm ?? '';
  return t.length > 0 && (scanNorm === t || (t.length >= MIN_TAIL && scanNorm.endsWith(t)));
}

/** The package whose tracking number is the scan, or its tail (USPS: 420 + ZIP in front). */
export function matchLabel(board: Board, scanNorm: string): PackageState | null {
  if (scanNorm.length < MIN_LABEL) {
    return null;
  }
  return board.packages.find((p) => labelHit(p.pkg.tracking_norm || normalize(p.pkg.tracking), scanNorm)) ?? null;
}

/** The order of the first incomplete matching item (else the first match) gets the row. */
function countRecord(pkg: PackageState, scanNorm: string, kind: 'sku' | 'manual', sku: string, raw: string | null): RecordSpec {
  const items = itemsMatching(pkg.items, scanNorm);
  const target = items.find((i) => !i.complete) ?? items[0];
  return {
    kind,
    result: 'ok',
    packageKey: pkg.key,
    orderKeys: [target.item.order_key],
    sku,
    raw,
  };
}

function needs(pkg: PackageState, scanNorm: string): boolean {
  return itemsMatching(pkg.items, scanNorm).some((i) => !i.complete);
}

/** @param code a scan already cleaned by normalizeScan; @param openKey the package on screen. */
export function decideScan(board: Board, openKey: string | null, code: string): Decision {
  const text = code.trim();
  const norm = normalize(text);
  const current = openKey ? (board.byKey.get(openKey) ?? null) : null;

  const pkg = matchLabel(board, norm);
  if (pkg) {
    return {
      type: 'label',
      pkg,
      left: current && current.key !== pkg.key && current.status === 'started' ? current : null,
      record: {
        kind: 'label',
        // Already known to be packed: no conflict for the Mac to report, it was
        // just said on screen. An ok label on a packed package means stale state.
        result: pkg.labelScanned || pkg.packedAt ? 'dup' : 'ok',
        packageKey: pkg.key,
        orderKeys: pkg.orders.map((o) => o.order.order_key),
        sku: null,
        raw: text,
      },
    };
  }

  // An item SKU.
  const active = current && !current.packedAt && current.packable ? current : null;
  if (active && itemsMatching(active.items, norm).length > 0) {
    const items = itemsMatching(active.items, norm);
    if (items.every((i) => i.complete)) {
      return {
        type: 'dup-open',
        pkg: active,
        sku: text,
        record: { kind: 'sku', result: 'dup', packageKey: active.key, orderKeys: [items[0].item.order_key], sku: text, raw: text },
      };
    }
    return { type: 'count', pkg: active, sku: text, viaOther: false, record: countRecord(active, norm, 'sku', text, text) };
  }

  const needing = board.packages.filter((p) => !p.packedAt && p.packable && p !== active && needs(p, norm));
  if (active && active.scans > 0) {
    // Never jump away from a package being filled: the item is wrong for it.
    return {
      type: 'wrong',
      pkg: active,
      sku: text,
      needing,
      record: {
        kind: 'sku',
        result: 'wrong',
        packageKey: active.key,
        orderKeys: [active.orders[0].order.order_key],
        sku: text,
        raw: text,
      },
    };
  }
  if (needing.length === 1) {
    const target = needing[0];
    return { type: 'count', pkg: target, sku: text, viaOther: true, record: countRecord(target, norm, 'sku', text, text) };
  }
  if (needing.length > 1) {
    return {
      type: 'ambiguous',
      sku: text,
      needing,
      record: { kind: 'sku', result: 'ambiguous', packageKey: null, orderKeys: [], sku: text, raw: text },
    };
  }
  const anywhere = board.packages.find((p) => itemsMatching(p.items, norm).length > 0);
  if (anywhere) {
    return {
      type: 'dup-elsewhere',
      pkg: anywhere,
      sku: text,
      record: { kind: 'sku', result: 'dup', packageKey: null, orderKeys: [], sku: text, raw: text },
    };
  }
  return {
    type: 'unknown',
    code: text,
    record: {
      kind: 'sku',
      result: 'unknown',
      packageKey: active?.key ?? null,
      orderKeys: active ? [active.orders[0].order.order_key] : [],
      sku: text,
      raw: text,
    },
  };
}

/** "Found it" for an item without a barcode: counts like one scan. */
export function decideManual(pkg: PackageState, sku: string): Decision {
  const norm = normalize(sku);
  const items = itemsMatching(pkg.items, norm);
  if (items.length === 0 || items.every((i) => i.complete)) {
    return { type: 'noop', pkg, tone: 'warning', title: `${skuText(sku)} is already accounted for` };
  }
  return { type: 'manual', pkg, sku, record: countRecord(pkg, norm, 'manual', sku, null) };
}

/** Packed outside the scan flow; recorded on every order as not scan-verified. */
export function decideMarkPacked(pkg: PackageState): Decision {
  if (pkg.packedAt) {
    return { type: 'noop', pkg, tone: 'warning', title: `${pkg.pkg.name} is already packed` };
  }
  return {
    type: 'mark',
    pkg,
    record: {
      kind: 'manual_packed',
      result: 'ok',
      packageKey: pkg.key,
      orderKeys: pkg.orders.map((o) => o.order.order_key),
      sku: null,
      raw: null,
    },
  };
}

export function undoLabel(pkg: PackageState): string | null {
  const target = undoTarget(pkg);
  if (!target) {
    return null;
  }
  const what =
    target.kind === 'label'
      ? 'the label scan'
      : target.kind === 'manual_packed'
        ? 'Mark packed'
        : target.sku || 'the item without a SKU';
  return target.source === 'desktop' ? `${what} (${target.kind === 'manual_packed' ? 'done' : 'scanned'} on the desktop)` : what;
}

export function decideUndo(pkg: PackageState): Decision {
  const target = undoTarget(pkg);
  if (!target) {
    return { type: 'noop', pkg, tone: 'warning', title: 'Nothing to undo for this package' };
  }
  return {
    type: 'undo',
    pkg,
    what: undoLabel(pkg) ?? '',
    record: {
      kind: 'undo',
      result: 'ok',
      packageKey: pkg.key,
      orderKeys: pkg.orders.map((o) => o.order.order_key),
      sku: target.sku,
      raw: null,
      undoes: target.refs,
    },
  };
}

/** An item's SKU for display; eBay lines can have none. */
export function skuText(sku: string | null | undefined): string {
  return sku ? sku : '(no SKU)';
}

// --- Wording -----------------------------------------------------------------------

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function progress(p: PackageState): string {
  return `${p.doneItems}/${p.totalItems} items, ${p.labelScanned ? 'label ✓' : 'label not scanned yet'}`;
}

function oneBox(p: PackageState): string {
  return p.orders.length > 1 ? ` (${p.orders.length} orders, one box)` : '';
}

function doneOutcome(p: PackageState, prefix = ''): Outcome {
  return {
    tone: 'success',
    sound: 'done',
    title: `${prefix}ALL ${p.totalItems} ITEMS ✓`,
    detail: `${p.pkg.name}${oneBox(p)}. Pack & stick the label.`,
    openKey: p.key,
    done: true,
  };
}

/** Did this action pack it? (Not packed before, packed now.) */
function justPacked(before: PackageState, after: PackageState): boolean {
  return Boolean(after.packedAt && !before.packedAt);
}

/** @param fresh the board after the decision's event was recorded. */
export function outcome(decision: Decision, fresh: Board): Outcome {
  switch (decision.type) {
    case 'label': {
      const before = decision.pkg;
      const after = fresh.byKey.get(before.key) ?? before;
      const left = decision.left ? ` Left ${decision.left.pkg.name} at ${decision.left.doneItems}/${decision.left.totalItems}.` : '';
      if (before.packedAt) {
        const where = before.packedSource === 'desktop' ? ' on the desktop' : '';
        return {
          tone: 'warning',
          sound: 'warn',
          title: `${before.pkg.name} was already packed${where} at ${hhmm(before.packedAt)}`,
          detail: `${before.manualPacked ? 'Marked by hand.' : ''}${left}`.trim() || undefined,
          openKey: before.key,
          done: false,
        };
      }
      if (before.cancelled) {
        return {
          tone: 'error',
          sound: 'error',
          title: `CANCELLED — do not ship ${before.cancelledNames.join(', ')}`,
          detail: left.trim() || undefined,
          openKey: before.key,
          done: false,
        };
      }
      if (before.pkg.label_count > 1) {
        return {
          tone: 'warning',
          sound: 'warn',
          title: `${before.pkg.name} has ${before.pkg.label_count} labels`,
          detail: `Pack it by hand, then Mark packed.${left}`,
          openKey: before.key,
          done: false,
        };
      }
      if (justPacked(before, after)) {
        return doneOutcome(after, 'Label ✓ — ');
      }
      const combined = after.orders.length > 1 ? ` — ${after.orders.length} orders in one box` : '';
      return {
        tone: decision.record.result === 'dup' ? 'warning' : 'success',
        sound: decision.record.result === 'dup' ? 'warn' : 'ok',
        title: decision.record.result === 'dup' ? `Label already scanned · ${after.pkg.name}` : `Label ✓ ${after.pkg.name}${combined}`,
        detail: `${after.doneItems}/${after.totalItems} items. Scan the items.${left}`,
        openKey: after.key,
        done: false,
      };
    }
    case 'count':
    case 'manual': {
      const after = fresh.byKey.get(decision.pkg.key) ?? decision.pkg;
      if (justPacked(decision.pkg, after)) {
        return doneOutcome(after);
      }
      if (decision.type === 'manual') {
        return {
          tone: 'success',
          sound: 'ok',
          title: `✋ ${skuText(decision.sku)} confirmed by hand`,
          detail: progress(after),
          openKey: after.key,
          done: false,
        };
      }
      return {
        tone: 'success',
        sound: 'ok',
        title: `✓ ${decision.sku}`,
        detail: decision.viaOther
          ? `Item for ${after.pkg.name} (${progress(after)}).${after.labelScanned ? '' : ' Scan its label to confirm.'}`
          : `In this package (${progress(after)}).`,
        openKey: after.key,
        done: false,
      };
    }
    case 'dup-open':
      return {
        tone: 'warning',
        sound: 'warn',
        title: `${decision.sku} already scanned`,
        detail: `For ${decision.pkg.pkg.name}.`,
        openKey: decision.pkg.key,
        done: false,
      };
    case 'wrong': {
      const { needing } = decision;
      const where =
        needing.length === 1
          ? `It belongs to ${needing[0].pkg.name}.`
          : needing.length > 1
            ? `It's in ${needing.length} other orders.`
            : undefined;
      return {
        tone: 'error',
        sound: 'error',
        title: `✗ ${decision.sku} is NOT in ${decision.pkg.pkg.name}`,
        detail: where,
        openKey: decision.pkg.key,
        done: false,
      };
    }
    case 'ambiguous': {
      const names = decision.needing.slice(0, 4).map((p) => p.pkg.name).join(', ');
      return {
        tone: 'warning',
        sound: 'warn',
        title: `${decision.sku} is in ${decision.needing.length} orders`,
        detail: `${names} — scan the label first.`,
        openKey: null,
        done: false,
      };
    }
    case 'dup-elsewhere':
      return {
        tone: 'warning',
        sound: 'warn',
        title: `${decision.sku} is already accounted for`,
        detail: `In ${decision.pkg.pkg.name}.`,
        openKey: null,
        done: false,
      };
    case 'unknown':
      return {
        tone: 'error',
        sound: 'error',
        title: `? ${decision.code}`,
        detail: "Not a loaded label or an item of any order to pack. If it's a new label, load labels again.",
        openKey: null,
        done: false,
      };
    case 'mark':
      return {
        tone: 'success',
        sound: 'done',
        title: `${decision.pkg.pkg.name} marked packed`,
        detail: 'By hand, not scan-verified.',
        openKey: decision.pkg.key,
        done: true,
      };
    case 'undo':
      return {
        tone: 'warning',
        sound: 'warn',
        title: `↶ Undid ${decision.what}`,
        openKey: decision.pkg.key,
        done: false,
      };
    case 'noop':
      return { tone: decision.tone, sound: 'warn', title: decision.title, openKey: null, done: false };
  }
}

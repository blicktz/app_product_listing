import { useEffect, useRef, useState } from 'react';
import {
  feedbackBoxOpen,
  feedbackError,
  feedbackRepeat,
  feedbackSuccess,
  feedbackWarning,
  preparePickFeedback,
} from '../pick/feedback';
import { normalizeScan } from '../pick/scan';
import type { Banner } from '../pick/useScanHandler';
import { describeElsewhere, planRangeStow } from '../rangeLabel';
import type { StowRow } from './derive';
import { classifyStowScan, oldBoxIndex } from './scan';
import {
  currentLocations,
  currentSession,
  getSnapshot,
  recordStowEvent,
  recordStowEvents,
  type StowRecordInput,
} from './store';

const AUTO_HIDE_MS = 3500;

type RangeScan = { code: string; printed: string; skus: string[] };

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

function unitCount(units: number | null): string | null {
  return units === null ? null : `${units} ${units === 1 ? 'unit' : 'units'}`;
}

export function useStowScan() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    preparePickFeedback();
  }, []);

  useEffect(() => {
    if (!banner || banner.actions) {
      return;
    }
    const timer = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  const show = (b: Omit<Banner, 'id'>) => setBanner({ ...b, id: nextId.current++ });
  const dismiss = () => setBanner(null);

  const openBox = (label: string, code: string) => {
    recordStowEvent({ action: 'box_open', boxLabel: label, scannedValue: code });
    feedbackBoxOpen();
    show({ tone: 'success', title: `${label} open`, detail: 'Scan items into this box.' });
  };

  const stowSku = (sku: string, code: string | null, method: 'scan' | 'manual') => {
    const box = currentSession()?.openBox ?? null;
    const known = currentLocations().get(sku);
    if (!box && known) {
      // A lookup only, so nothing is recorded. It stays up while the box is found.
      feedbackRepeat();
      show({
        tone: 'success',
        title: `${sku} is in ${known.box}`,
        detail: [
          unitCount(known.units),
          known.previous ? `Previous box ${known.previous}` : null,
          'Scan a box to stow or move it.',
        ]
          .filter(Boolean)
          .join(' · '),
        actions: [{ label: 'OK', primary: true, onPress: dismiss }],
      });
      return;
    }
    if (!box) {
      feedbackError();
      recordStowEvent({ action: 'reject', sku, method, scannedValue: code, note: 'no box open' });
      show({ tone: 'error', title: 'Scan a box first', detail: `${sku} was not stowed.` });
      return;
    }

    if (known && known.box !== box) {
      // Moved at once. The count restarts at 1 and each remaining unit is scanned.
      // The old count is kept so ↶ on its row can put it back.
      recordStowEvent({
        action: 'stow',
        boxLabel: box,
        sku,
        units: 1,
        movedFromBox: known.box,
        movedUnits: known.units,
        method,
        scannedValue: code,
      });
      const back = known.previous === box;
      if (back) {
        feedbackSuccess();
      } else {
        feedbackWarning();
      }
      show({
        tone: back ? 'success' : 'warning',
        title: back ? `${sku} moved back here` : `${sku} moved here`,
        detail: `${[`From ${known.box}`, known.units === null ? null : `had ${known.units}`]
          .filter(Boolean)
          .join(' · ')}. Count restarts at 1. Scan every remaining unit, one scan each.`,
      });
      return;
    }

    recordStowEvent({ action: 'stow', boxLabel: box, sku, units: 1, method, scannedValue: code });
    if (known) {
      feedbackRepeat();
      const session = currentSession();
      const row = session?.boxes.find((b) => b.label === box)?.rows.find((r) => r.sku === sku && r.kind === 'stow');
      const inBox = currentLocations().get(sku)?.units ?? row?.units ?? 1;
      show({ tone: 'success', title: `${sku} ×${row?.units ?? 1} · ${inBox} in this box` });
    } else {
      feedbackSuccess();
      show({ tone: 'success', title: `${sku} stowed` });
    }
  };

  /**
   * A range label: every SKU of the batch goes into the open box, as one stow
   * event each in a single write. SKUs already in this box are skipped (a range
   * never adds a unit); SKUs in other boxes are moved only after a confirmation.
   */
  const stowRange = (range: RangeScan, method: 'scan' | 'manual') => {
    const box = currentSession()?.openBox ?? null;
    const locations = currentLocations();
    const total = range.skus.length;

    if (!box) {
      // A lookup only, like a single SKU with no box open.
      const unstowed = range.skus.filter((sku) => !locations.has(sku)).length;
      const perBox = new Map<string, number>();
      for (const sku of range.skus) {
        const at = locations.get(sku)?.box;
        if (at) {
          perBox.set(at, (perBox.get(at) ?? 0) + 1);
        }
      }
      feedbackRepeat();
      show({
        tone: 'success',
        title: `${range.printed} · ${plural(total, 'SKU')}`,
        detail: [
          unstowed > 0 ? `${unstowed} not stowed yet` : null,
          ...[...perBox].map(([b, n]) => `${n} in ${b}`),
          'Scan a box to stow them.',
        ]
          .filter(Boolean)
          .join(' · '),
        actions: [{ label: 'OK', primary: true, onPress: dismiss }],
      });
      return;
    }

    const plan = planRangeStow(range.skus, box, locations);
    if (plan.fresh.length === 0 && plan.elsewhere.length === 0) {
      feedbackRepeat();
      show({ tone: 'success', title: `All ${total} already in ${box}`, detail: `${range.printed}. Nothing changed.` });
      return;
    }

    const record = (moveToo: boolean) => {
      const moving = new Map(moveToo ? plan.elsewhere.map((e) => [e.sku, e]) : []);
      const fresh = new Set(plan.fresh);
      const skus = range.skus.filter((sku) => fresh.has(sku) || moving.has(sku));
      const inputs: StowRecordInput[] = skus.map((sku, i) => {
        const move = moving.get(sku);
        return {
          action: 'stow',
          boxLabel: box,
          sku,
          units: 1,
          ...(move ? { movedFromBox: move.box, movedUnits: move.units } : {}),
          method,
          scannedValue: range.code,
          note: `range ${i + 1}/${skus.length}`,
        };
      });
      recordStowEvents(inputs);
      const skipped = [
        plan.here.length > 0 ? `${plan.here.length} already here` : null,
        !moveToo && plan.elsewhere.length > 0 ? `${plan.elsewhere.length} left in other boxes` : null,
      ].filter(Boolean);
      if (moving.size > 0) {
        feedbackWarning();
        show({
          tone: 'warning',
          title: `${skus.length} stowed · ${moving.size} moved from other boxes`,
          detail: [range.printed, ...skipped].join(' · '),
        });
      } else {
        feedbackSuccess();
        show({
          tone: 'success',
          title: skipped.length > 0 ? [`${skus.length} stowed`, ...skipped].join(' · ') : `${plural(skus.length, 'SKU')} stowed in ${box}`,
          detail: range.printed,
        });
      }
    };

    if (plan.elsewhere.length === 0) {
      record(false);
      return;
    }
    // Part of the batch is in other boxes: most likely a wrong label or a wrong box.
    const movable = plan.fresh.length + plan.elsewhere.length;
    feedbackWarning();
    show({
      tone: 'warning',
      title: `${plan.elsewhere.length} of these ${total} SKUs are in other boxes`,
      detail: describeElsewhere(plan.elsewhere),
      actions: [
        { label: `Move all ${movable} here`, primary: true, onPress: () => record(true) },
        ...(plan.fresh.length > 0
          ? [{ label: `Stow the ${plan.fresh.length} others only`, onPress: () => record(false) }]
          : []),
        { label: 'Cancel', onPress: dismiss },
      ],
    });
  };

  const rejectRange = (code: string, reason: string, method: 'scan' | 'manual') => {
    feedbackError();
    recordStowEvent({
      action: 'reject',
      boxLabel: currentSession()?.openBox ?? null,
      method,
      scannedValue: code,
      note: 'bad range',
    });
    show({ tone: 'error', title: `Not a valid range: ${code}`, detail: `${reason[0].toUpperCase()}${reason.slice(1)}.` });
  };

  const handleScan = (code: string) => {
    const result = classifyStowScan(code, oldBoxIndex(getSnapshot().server));
    switch (result.kind) {
      case 'range':
        stowRange(result, 'scan');
        return;
      case 'bad-range':
        rejectRange(code, result.reason, 'scan');
        return;
      case 'box':
        // The box already open: nothing to do and nothing to record.
        if (currentSession()?.openBox !== result.label) {
          openBox(result.label, code);
        }
        return;
      case 'sku':
        stowSku(result.sku, code, 'scan');
        return;
      case 'invalid':
        feedbackError();
        recordStowEvent({
          action: 'reject',
          boxLabel: currentSession()?.openBox ?? null,
          scannedValue: code,
          note: 'unrecognised barcode',
        });
        show({ tone: 'error', title: `Unrecognised barcode: ${code}` });
        return;
    }
  };

  /** For an unreadable label. Only a SKU can be typed; boxes must be scanned. */
  const enterSku = (typed: string) => {
    const text = normalizeScan(typed);
    if (!text) {
      return;
    }
    const result = classifyStowScan(text, new Map());
    if (result.kind === 'sku') {
      stowSku(result.sku, null, 'manual');
      return;
    }
    if (result.kind === 'range') {
      stowRange(result, 'manual');
      return;
    }
    if (result.kind === 'bad-range') {
      rejectRange(text, result.reason, 'manual');
      return;
    }
    feedbackError();
    recordStowEvent({
      action: 'reject',
      boxLabel: currentSession()?.openBox ?? null,
      method: 'manual',
      note: `typed: ${text}`,
    });
    show({ tone: 'error', title: `Not a SKU: ${text}` });
  };

  const setQuantity = (row: StowRow, quantity: number) => {
    const change = quantity - (row.units ?? 0);
    if (change !== 0) {
      recordStowEvent({
        action: 'adjust',
        boxLabel: row.boxLabel,
        sku: row.sku,
        units: change,
        method: 'manual',
      });
    }
  };

  const undoInput = (row: StowRow): StowRecordInput => ({
    action: 'undo',
    boxLabel: row.boxLabel,
    sku: row.sku,
    units: row.units,
    undoesEventId: row.lastEventId,
    method: 'manual',
  });

  const undoRow = (row: StowRow) => {
    recordStowEvent(undoInput(row));
  };

  /** ↶ on a range group: takes back every row of that scan, newest first, in one write. */
  const undoRows = (rows: StowRow[]) => {
    recordStowEvents([...rows].sort((a, b) => b.scanSeq - a.scanSeq).map(undoInput));
  };

  /** Ends the session and returns its ID for the summary screen. */
  const finish = (): string | null => {
    const session = currentSession();
    if (!session) {
      return null;
    }
    dismiss();
    recordStowEvent({ action: 'session_end', method: 'manual' });
    return session.id;
  };

  return { banner, dismiss, handleScan, enterSku, setQuantity, undoRow, undoRows, finish };
}

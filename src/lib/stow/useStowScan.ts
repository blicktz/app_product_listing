import { useEffect, useRef, useState } from 'react';
import { feedbackError, feedbackRepeat, feedbackSuccess, feedbackWarning, preparePickFeedback } from '../pick/feedback';
import { normalizeScan } from '../pick/scan';
import type { Banner } from '../pick/useScanHandler';
import type { StowRow } from './derive';
import { classifyStowScan, oldBoxIndex } from './scan';
import { currentLocations, currentSession, getSnapshot, recordStowEvent } from './store';

const AUTO_HIDE_MS = 3500;

type PendingMove = {
  sku: string;
  box: string;
  from: string;
  code: string | null;
  method: 'scan' | 'manual';
};

export function useStowScan() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const nextId = useRef(1);
  const pendingMove = useRef<PendingMove | null>(null);

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

  /** A move question left unanswered still has to be on record: the item stayed put. */
  const declinePendingMove = (note: string | null) => {
    const pending = pendingMove.current;
    if (!pending) {
      return;
    }
    pendingMove.current = null;
    recordStowEvent({
      action: 'move_declined',
      boxLabel: pending.box,
      sku: pending.sku,
      movedFromBox: pending.from,
      method: pending.method,
      scannedValue: pending.code,
      note,
    });
  };

  const openBox = (label: string, code: string) => {
    declinePendingMove('replaced by the next scan');
    recordStowEvent({ action: 'box_open', boxLabel: label, scannedValue: code });
    feedbackSuccess();
    show({ tone: 'success', title: `${label} open`, detail: 'Scan items into this box.' });
  };

  const stowSku = (sku: string, code: string | null, method: 'scan' | 'manual') => {
    declinePendingMove('replaced by the next scan');
    const box = currentSession()?.openBox ?? null;
    if (!box) {
      feedbackError();
      recordStowEvent({ action: 'reject', sku, method, scannedValue: code, note: 'no box open' });
      show({ tone: 'error', title: 'Scan a box first', detail: `${sku} was not stowed.` });
      return;
    }

    const known = currentLocations().get(sku);
    if (known && known.box !== box) {
      feedbackWarning();
      pendingMove.current = { sku, box, from: known.box, code, method };
      show({
        tone: 'warning',
        title: `${sku} is in ${known.box}`,
        detail:
          known.units === null
            ? 'Move it here?'
            : `${known.units} ${known.units === 1 ? 'unit' : 'units'}. Move them all here?`,
        actions: [
          {
            label: 'No',
            onPress: () => {
              declinePendingMove(null);
              dismiss();
            },
          },
          {
            label: 'Yes, move all',
            primary: true,
            onPress: () => {
              pendingMove.current = null;
              recordStowEvent({
                action: 'stow',
                boxLabel: box,
                sku,
                movedFromBox: known.box,
                movedUnits: known.units,
                method,
                scannedValue: code,
              });
              feedbackSuccess();
              show({
                tone: 'success',
                title: `${sku} moved here`,
                detail: known.units === null ? undefined : `×${known.units}`,
              });
            },
          },
        ],
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

  const handleScan = (code: string) => {
    const result = classifyStowScan(code, oldBoxIndex(getSnapshot().server));
    switch (result.kind) {
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
        declinePendingMove('replaced by the next scan');
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

  const undoRow = (row: StowRow) => {
    recordStowEvent({
      action: 'undo',
      boxLabel: row.boxLabel,
      sku: row.sku,
      units: row.units,
      undoesEventId: row.lastEventId,
      method: 'manual',
    });
  };

  /** Ends the session and returns its ID for the summary screen. */
  const finish = (): string | null => {
    const session = currentSession();
    if (!session) {
      return null;
    }
    declinePendingMove('session finished');
    dismiss();
    recordStowEvent({ action: 'session_end', method: 'manual' });
    return session.id;
  };

  return { banner, dismiss, handleScan, enterSku, setQuantity, undoRow, finish };
}

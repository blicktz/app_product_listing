import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { boxScanIndex, sameBoxLabel } from '../pick/boxLabel';
import { groupBoxes, isDone, labelSku, type LineState } from '../pick/derive';
import { feedbackBoxOpen, feedbackError, feedbackSuccess, feedbackWarning, preparePickFeedback } from '../pick/feedback';
import { classifyScan, resolveItemScan } from '../pick/scan';
import { findInOrders, setPickMode } from '../pick/store';
import type { Banner, BannerAction } from '../pick/useScanHandler';
import {
  getWhatnotSnapshot,
  recordWhatnotEvent,
  subscribe,
  whatnotLineStates,
  type WhatnotSnapshot,
} from './store';
import type { WhatnotLine } from './types';

export const DEFAULT_PREP_BOX = 'ST-PRE-WHT-001';

export function useWhatnotSnapshot(): WhatnotSnapshot {
  return useSyncExternalStore(subscribe, getWhatnotSnapshot);
}

export type LineupRow = { line: WhatnotLine; state: LineState | undefined };

/** The open show with this phone's picks applied: boxes to pull from, the lineup, and counts. */
export function useWhatnotData() {
  const snap = useWhatnotSnapshot();
  const plan = snap.plan?.plan ?? null;
  const prepBox = plan?.prep_box ?? snap.shows?.prep_box ?? DEFAULT_PREP_BOX;
  return useMemo(() => {
    const states = whatnotLineStates(snap);
    const lines = new Map((plan?.lines ?? []).map((l) => [l.line_key, l]));
    const sold = (key: string) => lines.get(key)?.status === 'sold';
    const inPrepNow = (s: LineState) => Boolean(s.line.box_id && sameBoxLabel(s.line.box_id, prepBox));
    // Boxes to pull from: unsold items still in a storage box on the last list.
    const pullable = [...states.values()].filter((s) => !sold(s.line.line_key) && !inPrepNow(s));
    const boxes = groupBoxes(pullable);
    const unlocated = pullable.filter((s) => !s.line.box_id && !isDone(s));
    const alreadyInPrep = [...states.values()].filter((s) => !sold(s.line.line_key) && inPrepNow(s));
    const lineup: LineupRow[] = [...(plan?.lines ?? [])]
      .sort((a, b) => a.lot - b.lot)
      .map((line) => ({ line, state: states.get(line.line_key) }));
    const live = [...states.values()].filter((s) => !sold(s.line.line_key));
    const picked = live.filter((s) => s.status === 'picked').length;
    const bundles = bundleProgress(plan?.lines ?? [], states);
    const missing = live.filter((s) => s.status === 'missing').length;
    return {
      snap,
      plan,
      prepBox,
      states,
      lines,
      boxes,
      unlocated,
      alreadyInPrep,
      lineup,
      bundles,
      total: live.length,
      picked,
      missing,
      toPick: live.length - picked - missing,
      soldCount: states.size - live.length,
    };
  }, [snap, plan, prepBox]);
}

export type BundleProgress = { sku: string; title: string | null; picked: number; total: number };

/** Per bundle: how many of its pieces are in the prep box (this phone's picks included). */
export function bundleProgress(lines: WhatnotLine[], states: Map<string, LineState>): Map<string, BundleProgress> {
  const out = new Map<string, BundleProgress>();
  for (const l of lines) {
    if (!l.bundle_sku) {
      continue;
    }
    const b = out.get(l.bundle_sku) ?? { sku: l.bundle_sku, title: l.bundle_title ?? null, picked: 0, total: 0 };
    b.total += 1;
    b.picked += states.get(l.line_key)?.status === 'picked' ? 1 : 0;
    out.set(l.bundle_sku, b);
  }
  return out;
}

/** "bundle BUD-0907-003 · piece 2 of 6" for a bundle piece, else ''. */
export function bundleNote(line: WhatnotLine | undefined): string {
  return line?.bundle_sku ? `bundle ${line.bundle_sku} · piece ${line.bundle_pos} of ${line.bundle_size}` : '';
}

/** '#07' with the show's number width. */
export function lotLabel(lot: number | undefined, width = 2): string {
  return lot ? `#${String(lot).padStart(width, '0')}` : '#?';
}

const AUTO_HIDE_MS = 3500;

type Options = {
  /** Box open on this screen; null on the Whatnot home and item screens. */
  boxId: string | null;
  /** The line this screen is about (item screen). */
  preferLineKey?: string | null;
  openBoxMode: 'push' | 'replace';
  onPicked?: (state: LineState) => void;
};

/** order Pick's useScanHandler, for a Whatnot show: same rules, its own list and banners. */
export function useWhatnotScan({ boxId, preferLineKey = null, openBoxMode, onPicked }: Options) {
  const router = useRouter();
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

  const openBox = (id: string) => {
    const route = { pathname: '/pick/whatnot/box/[boxId]', params: { boxId: id } } as const;
    if (openBoxMode === 'replace') {
      router.replace(route);
    } else {
      router.push(route);
    }
  };

  const context = () => {
    const snap = getWhatnotSnapshot();
    const plan = snap.plan?.plan ?? null;
    const prepBox = plan?.prep_box ?? DEFAULT_PREP_BOX;
    const lines = new Map((plan?.lines ?? []).map((l) => [l.line_key, l]));
    const states = [...whatnotLineStates(snap).values()].filter((s) => lines.get(s.line.line_key)?.status !== 'sold');
    return { plan, prepBox, lines, states };
  };

  const pick = (state: LineState, fromBox: string | null, code: string | null, method: 'scan' | 'manual') => {
    const { plan, prepBox, lines } = context();
    recordWhatnotEvent({ action: 'pick', line: state.line, boxId: fromBox, method, scannedValue: code });
    feedbackSuccess();
    const line = lines.get(state.line.line_key);
    const lot = line?.lot;
    let detail = `${labelSku(state.line.sku)} · put it with #${lot ?? '?'} in the lineup`;
    if (line?.bundle_sku) {
      const b = bundleProgress([...lines.values()], whatnotLineStates()).get(line.bundle_sku);
      detail = b && b.picked >= b.total
        ? `${labelSku(state.line.sku)} · bundle ${line.bundle_sku} complete (${b.total}/${b.total}): put it together`
        : `${labelSku(state.line.sku)} · bundle ${line.bundle_sku}: ${b?.picked ?? '?'} of ${b?.total ?? '?'} pieces`;
    }
    show({ tone: 'success', title: `${lotLabel(lot, plan?.number_width)} → ${prepBox}`, detail });
    onPicked?.(state);
  };

  const handleScan = (code: string) => {
    const { plan, prepBox, lines, states } = context();
    if (!plan) {
      feedbackWarning();
      show({ tone: 'warning', title: 'No show open', detail: 'Choose a show first.' });
      return;
    }
    if (sameBoxLabel(code, prepBox)) {
      feedbackWarning();
      show({ tone: 'info', title: `${prepBox} is the prep box`, detail: 'Scan a storage box or an item to pick.' });
      return;
    }
    const boxIndex = boxScanIndex(states.map((s) => s.line));
    if (classifyScan(code, states, new Set(boxIndex.keys())) === 'box') {
      const targets = boxIndex.get(code) ?? [code];
      if (boxId && targets.includes(boxId)) {
        return;
      }
      const boxes = groupBoxes(states.filter((s) => !(s.line.box_id && sameBoxLabel(s.line.box_id, prepBox))));
      const target = targets.find((id) => boxes.has(id));
      if (!target) {
        feedbackWarning();
        recordWhatnotEvent({ action: 'reject', boxId, scannedValue: code, sku: code, note: 'box not on show' });
        show({ tone: 'warning', title: `Nothing to pick in ${code}`, detail: `No item of “${plan.title}” is in it.` });
        return;
      }
      feedbackBoxOpen();
      dismiss();
      openBox(target);
      return;
    }

    const soldLine = [...lines.values()].find((l) => labelSku(l.sku) === code && l.status === 'sold');
    if (soldLine) {
      feedbackWarning();
      show({ tone: 'warning', title: `${lotLabel(soldLine.lot, plan.number_width)} ${code} already sold`, detail: 'Leave it out of the lineup.' });
      return;
    }

    const result = resolveItemScan(code, states, boxId, preferLineKey);
    switch (result.kind) {
      case 'pick':
        pick(result.state, result.boxId, code, 'scan');
        return;
      case 'other-box': {
        feedbackWarning();
        const { state, listedIn } = result;
        const actions: BannerAction[] = boxId
          ? [
              { label: 'No', onPress: dismiss },
              { label: 'Yes, pick', primary: true, onPress: () => pick(state, boxId, code, 'scan') },
            ]
          : [
              ...(listedIn
                ? [{ label: `Open ${listedIn}`, onPress: () => { dismiss(); openBox(listedIn); } }]
                : []),
              { label: 'Pick anyway', primary: true, onPress: () => pick(state, null, code, 'scan') },
            ];
        show({
          tone: 'warning',
          title: `${labelSku(state.line.sku)} is listed in ${listedIn ?? 'no box'}`,
          detail: boxId ? `Picked it here from ${boxId}?` : 'No box is open.',
          actions,
        });
        return;
      }
      case 'already-picked':
        feedbackWarning();
        show({ tone: 'warning', title: `${code} is already in ${prepBox}` });
        return;
      case 'not-on-list': {
        const order = findInOrders(code);
        recordWhatnotEvent({ action: 'reject', boxId, scannedValue: code, sku: code, note: 'not on show' });
        if (order) {
          feedbackWarning();
          show({
            tone: 'warning',
            title: `${code} is on an order to ship`,
            detail: `${order.line.title} · not on “${plan.title}”. Nothing recorded.`,
            actions: [
              { label: 'OK', onPress: dismiss },
              {
                label: 'Switch to Orders',
                primary: true,
                onPress: () => {
                  dismiss();
                  setPickMode('orders');
                  router.navigate('/pick');
                },
              },
            ],
          });
          return;
        }
        feedbackError();
        show({ tone: 'error', title: `${code} isn't in “${plan.title}”` });
        return;
      }
    }
  };

  const confirmManual = (state: LineState) => pick(state, boxId, null, 'manual');

  return { banner, dismiss, handleScan, confirmManual };
}

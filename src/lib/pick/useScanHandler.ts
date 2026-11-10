import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { groupBoxes, knownBoxIds, labelSku, type LineState } from './derive';
import { feedbackError, feedbackSuccess, feedbackWarning, preparePickFeedback } from './feedback';
import { classifyScan, resolveItemScan } from './scan';
import { currentLineStates, getSnapshot, recordEvent } from './store';

export type BannerAction = { label: string; primary?: boolean; onPress: () => void };

export type Banner = {
  id: number;
  tone: 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  /** With actions the banner stays until one is tapped. */
  actions?: BannerAction[];
};

const AUTO_HIDE_MS = 3500;

type Options = {
  /** Box open on this screen; null on Pick home and Can't find. */
  boxId: string | null;
  /** The line this screen is about (Can't find, image viewer). */
  preferLineKey?: string | null;
  /** How box scans open a box: replace this screen, or push on top of it. */
  openBoxMode: 'push' | 'replace';
  /** Called after a pick is recorded (the image viewer closes itself). */
  onPicked?: (state: LineState) => void;
  /** False where a box can't be opened (the full-screen image viewer). */
  allowBoxScan?: boolean;
};

export function useScanHandler({
  boxId,
  preferLineKey = null,
  openBoxMode,
  onPicked,
  allowBoxScan = true,
}: Options) {
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
    const route = { pathname: '/pick/box/[boxId]', params: { boxId: id } } as const;
    if (openBoxMode === 'replace') {
      router.replace(route);
    } else {
      router.push(route);
    }
  };

  const pick = (state: LineState, fromBox: string | null, code: string | null, method: 'scan' | 'manual') => {
    recordEvent({ action: 'pick', line: state.line, boxId: fromBox, method, scannedValue: code });
    feedbackSuccess();
    // Re-read: the pick just recorded is in the store now.
    const after = currentLineStates().get(state.line.line_key);
    const box = fromBox ? groupBoxes(currentLineStates().values()).get(fromBox) : undefined;
    const lineLeft = after ? Math.max(1, after.line.qty) - after.pickedQty : 0;
    const boxLeft = box ? box.totalQty - box.pickedQty : null;
    show({
      tone: 'success',
      title: `${labelSku(state.line.sku)} picked`,
      detail:
        lineLeft > 0
          ? `${lineLeft} more of this item`
          : boxLeft !== null
            ? boxLeft > 0
              ? `${boxLeft} left in ${fromBox}`
              : `${fromBox} done`
            : undefined,
    });
    onPicked?.(state);
  };

  const handleScan = (code: string) => {
    const snap = getSnapshot();
    const states = currentLineStates();

    if (classifyScan(code, states.values(), knownBoxIds(snap.list?.lines ?? [])) === 'box') {
      if (code === boxId) {
        return;
      }
      if (!allowBoxScan) {
        feedbackWarning();
        show({ tone: 'warning', title: `Close the photo to open ${code}` });
        return;
      }
      const box = groupBoxes(states.values()).get(code);
      if (!box) {
        feedbackWarning();
        show({ tone: 'warning', title: `Nothing to pick in ${code}` });
        return;
      }
      dismiss();
      openBox(code);
      return;
    }

    const result = resolveItemScan(code, states.values(), boxId, preferLineKey);
    switch (result.kind) {
      case 'pick':
        pick(result.state, result.boxId, code, 'scan');
        return;
      case 'other-box': {
        feedbackWarning();
        const { state, listedIn } = result;
        const sku = labelSku(state.line.sku);
        const actions: BannerAction[] = boxId
          ? [
              { label: 'No', onPress: dismiss },
              {
                label: 'Yes, pick',
                primary: true,
                onPress: () => pick(state, boxId, code, 'scan'),
              },
            ]
          : [
              ...(listedIn
                ? [{ label: `Open ${listedIn}`, onPress: () => { dismiss(); openBox(listedIn); } }]
                : []),
              { label: 'Pick anyway', primary: true, onPress: () => pick(state, null, code, 'scan') },
            ];
        show({
          tone: 'warning',
          title: `${sku} is listed in ${listedIn ?? 'no box'}`,
          detail: boxId ? `Picked it here from ${boxId}?` : 'No box is open.',
          actions,
        });
        return;
      }
      case 'already-picked':
        feedbackWarning();
        recordEvent({ action: 'reject', boxId, scannedValue: code, note: 'already picked' });
        show({ tone: 'warning', title: `${code} is already picked` });
        return;
      case 'not-on-list':
        feedbackError();
        recordEvent({ action: 'reject', boxId, scannedValue: code });
        show({ tone: 'error', title: `${code} isn't in any order` });
        return;
    }
  };

  const confirmManual = (state: LineState) => pick(state, boxId, null, 'manual');

  return { banner, dismiss, handleScan, confirmManual };
}

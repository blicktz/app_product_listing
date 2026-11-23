import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { boxScanIndex } from '../pick/boxLabel';
import { feedbackBoxOpen, feedbackError, feedbackPulled, feedbackWarning, preparePickFeedback } from '../pick/feedback';
import type { Banner, BannerAction } from '../pick/useScanHandler';
import { groupBoxes, type PullLineState } from './derive';
import { classifyScan, resolveItemScan } from './scan';
import {
  currentLines,
  getSnapshot,
  pullBlock,
  recordReject,
  resendPending,
  sendEvent,
  type EventInput,
  type SendResult,
} from './store';
import { looksLikeRange, RANGE_STOW_ONLY, RANGE_STOW_ONLY_DETAIL } from '../rangeLabel';

// Scan + button handling for the Pull screens. Every pull, finish, missing or
// undo goes to the Mac and counts only on its answer (online only, §5.3).

const AUTO_HIDE_MS = 3500;

type Options = {
  /** Box open on this screen; null on Pull home and Can't find. */
  boxId: string | null;
  preferLineKey?: string | null;
  openBoxMode: 'push' | 'replace';
  onPulled?: (state: PullLineState) => void;
  allowBoxScan?: boolean;
};

/** The picker-facing words for a reject code (§5.3). */
function rejectMessage(reason: string | null, sku: string): { title: string; detail?: string } {
  switch (reason) {
    case 'action_cancelled':
      return { title: `Not counted: the End for ${sku} was cancelled`, detail: 'Leave it in the box.' };
    case 'needed_for_order':
      return { title: `${sku} is on an open order`, detail: 'Not counted. Leave it in the box.' };
    case 'line_complete':
      return { title: `${sku} is already done`, detail: 'Not counted.' };
    case 'not_on_list':
      return { title: `${sku} isn't on the pull list`, detail: 'Not counted. Leave it in the box.' };
    case 'held':
      return { title: `${sku} is on hold`, detail: 'Not counted. Leave it in the box and reload the list.' };
    case 'old_round':
      return { title: 'Not counted: the list is out of date', detail: 'Reload the pull list.' };
    case 'nothing_to_undo':
      return { title: 'Nothing to undo' };
    case 'orders_not_synced':
      return { title: 'Not counted: orders aren’t synced', detail: 'Pulling is paused. Reload to try again.' };
    default:
      return { title: 'Not counted: the Mac refused it', detail: reason ? `(${reason})` : undefined };
  }
}

function blockMessage(): string | null {
  switch (pullBlock()) {
    case 'offline':
      return 'Pull needs the Mac';
    case 'orders_not_synced':
      return 'Pulling is paused: orders aren’t synced';
    case 'orders_syncing':
      return 'Wait: the Mac is syncing orders';
    case 'no_list':
      return 'Load the pull list first';
    default:
      return null;
  }
}

export function usePullScanHandler({
  boxId,
  preferLineKey = null,
  openBoxMode,
  onPulled,
  allowBoxScan = true,
}: Options) {
  const router = useRouter();
  const [banner, setBanner] = useState<Banner | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    preparePickFeedback();
  }, []);

  useEffect(() => {
    if (!banner || banner.actions || banner.tone === 'info') {
      return;
    }
    const timer = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  const show = (b: Omit<Banner, 'id'>) => setBanner({ ...b, id: nextId.current++ });
  const dismiss = () => setBanner(null);

  const openBox = (id: string) => {
    const route = { pathname: '/pull/box/[boxId]', params: { boxId: id } } as const;
    if (openBoxMode === 'replace') {
      router.replace(route);
    } else {
      router.push(route);
    }
  };

  /** Shows the outcome of a send. Returns true when the Mac accepted it. */
  const report = (result: SendResult, sku: string, verb: string, line: PullLineState | null): boolean => {
    switch (result.kind) {
      case 'busy':
        feedbackWarning();
        show({ tone: 'warning', title: 'Wait for the last scan', detail: 'Still waiting for the Mac’s answer.' });
        return false;
      case 'refused':
        feedbackError();
        show({ tone: 'error', title: 'Not counted: the Mac refused the request', detail: result.message });
        return false;
      case 'no-answer':
        feedbackError();
        show({
          tone: 'error',
          title: `Not counted: no answer from the Mac`,
          detail: `${sku} · ${verb}. Retrying sends the same scan, so it can’t count twice.`,
          actions: [
            {
              label: 'Retry',
              primary: true,
              onPress: () => {
                show({ tone: 'info', title: `${sku} · sending…` });
                void resendPending().then((r) => {
                  if (r) {
                    report(r, sku, verb, line);
                  } else {
                    dismiss();
                  }
                });
              },
            },
          ],
        });
        return false;
      case 'reply': {
        const { reply, event } = result;
        if (!reply.accepted) {
          feedbackError();
          show({ tone: 'error', ...rejectMessage(reply.reason, sku) });
          return false;
        }
        const after = reply.line;
        if (event.action === 'pull') {
          feedbackPulled();
          const left = after && after.units_to_pull !== null ? Math.max(0, after.units_to_pull - after.pulled_qty) : null;
          let detail: string | undefined;
          if (after?.complete) {
            const box = event.box_id ? groupBoxes(currentLines().values()).get(event.box_id) : undefined;
            const boxLeft = box ? box.lines.length - box.doneLines : null;
            detail =
              boxLeft === null ? 'Line done' : boxLeft > 0 ? `Line done · ${boxLeft} left in ${event.box_id}` : `${event.box_id} done`;
          } else if (left !== null) {
            detail = `${left} more of this item`;
          } else if (after) {
            detail = `${after.pulled_qty} scanned · scan the next, or tap No more`;
          }
          show({ tone: 'success', title: `${sku} pulled`, detail });
        } else {
          feedbackBoxOpen();
          show({ tone: 'success', title: `${sku} · ${verb}` });
        }
        return true;
      }
    }
  };

  const send = async (input: EventInput, verb: string): Promise<boolean> => {
    const line = input.line ?? null;
    const sku = line?.sku ?? '';
    // An undo takes nothing off the shelf, so only a missing Mac stops it (§5.6).
    const block = pullBlock();
    const blocked =
      input.action === 'undo' ? (block === 'offline' || block === 'no_list' ? blockMessage() : null) : blockMessage();
    if (blocked) {
      feedbackWarning();
      show({ tone: 'warning', title: blocked, detail: 'Not counted.' });
      return false;
    }
    if (getSnapshot().pending) {
      return report({ kind: 'busy' }, sku, verb, line);
    }
    show({ tone: 'info', title: `${sku} · sending…` });
    const result = await sendEvent(input);
    return report(result, sku, verb, line);
  };

  const pull = async (state: PullLineState, fromBox: string | null, code: string | null, method: 'scan' | 'manual') => {
    const ok = await send({ action: 'pull', line: state, boxId: fromBox, method, scannedValue: code }, 'pull');
    if (ok) {
      onPulled?.(state);
    }
  };

  const handleScan = (code: string) => {
    if (looksLikeRange(code)) {
      // A range label stows a whole card batch: Stow only. Everything else is card by card.
      feedbackError();
      show({ tone: 'error', title: RANGE_STOW_ONLY, detail: RANGE_STOW_ONLY_DETAIL });
      return;
    }
    const states = currentLines();
    const list = getSnapshot().list;

    const boxIndex = boxScanIndex(list?.lines ?? []);
    if (classifyScan(code, states.values(), new Set(boxIndex.keys())) === 'box') {
      const targets = boxIndex.get(code) ?? [code];
      if (boxId && targets.includes(boxId)) {
        return;
      }
      if (!allowBoxScan) {
        feedbackWarning();
        show({ tone: 'warning', title: `Close the photo to open ${code}` });
        return;
      }
      const boxes = groupBoxes(states.values());
      const target = targets.find((id) => boxes.has(id));
      if (!target) {
        feedbackWarning();
        recordReject({ boxId, scannedValue: code, note: 'box not on list' });
        show({ tone: 'warning', title: `Nothing to pull in ${code}` });
        return;
      }
      feedbackBoxOpen();
      dismiss();
      openBox(target);
      return;
    }

    const result = resolveItemScan(code, states.values(), boxId, preferLineKey);
    switch (result.kind) {
      case 'pull':
        void pull(result.state, result.boxId, code, 'scan');
        return;
      case 'other-box': {
        feedbackWarning();
        const { state, listedIn } = result;
        const actions: BannerAction[] = boxId
          ? [
              { label: 'No', onPress: dismiss },
              { label: 'Yes, pull', primary: true, onPress: () => void pull(state, boxId, code, 'scan') },
            ]
          : [
              ...(listedIn
                ? [{ label: `Open ${listedIn}`, onPress: () => { dismiss(); openBox(listedIn); } }]
                : []),
              { label: 'Pull anyway', primary: true, onPress: () => void pull(state, null, code, 'scan') },
            ];
        show({
          tone: 'warning',
          title: `${state.sku} is listed in ${listedIn ?? 'no box'}`,
          detail: boxId ? `Pulled it here from ${boxId}?` : 'No box is open.',
          actions,
        });
        return;
      }
      case 'already-done':
        feedbackWarning();
        recordReject({ line: result.state, boxId, scannedValue: code, note: 'already done' });
        show({ tone: 'warning', title: `${code} is already done`, detail: 'Not counted.' });
        return;
      case 'not-on-list':
        feedbackError();
        recordReject({ boxId, scannedValue: code });
        show({ tone: 'error', title: `${code} isn't on the pull list`, detail: 'Not counted. Leave it in the box.' });
        return;
    }
  };

  return {
    banner,
    dismiss,
    handleScan,
    pullManual: (state: PullLineState) => pull(state, boxId, null, 'manual'),
    finish: (state: PullLineState) =>
      send({ action: 'finish', line: state, boxId, method: 'manual' }, 'finished'),
    markMissing: (state: PullLineState, note: string | null) =>
      send({ action: 'missing', line: state, boxId, method: 'manual', note }, 'marked missing'),
    undo: (state: PullLineState, reason: string) =>
      send({ action: 'undo', line: state, boxId, method: 'manual', note: reason }, 'undone'),
  };
}

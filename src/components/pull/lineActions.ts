import { ActionSheetIOS, Alert } from 'react-native';
import type { PullLineState } from '@/lib/pull/derive';
import { getSnapshot } from '@/lib/pull/store';

// The confirmations in front of every Pull action that can't be scanned:
// manual pull, "No more in this box", Mark missing and Undo. Each one names
// what will happen, because a pulled item is disposed of for good.

export function confirmManualPull(state: PullLineState, onConfirm: () => void) {
  Alert.alert(
    'Pull 1 unit without scanning?',
    `${state.sku}\n${state.title}\n\nIt will be disposed of.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pull 1', style: 'destructive', onPress: onConfirm },
    ]
  );
}

export function confirmFinish(state: PullLineState, onConfirm: () => void) {
  if (state.pulled_qty === 0) {
    Alert.alert(
      'Nothing scanned yet',
      'Scan each unit first. If the item isn’t here, use Can’t find, then Mark missing.'
    );
    return;
  }
  const units = state.units_to_pull;
  const message =
    units === null
      ? `Finish ${state.sku} with ${state.pulled_qty} ${state.pulled_qty === 1 ? 'unit' : 'units'}? The box’s record for it is removed.`
      : `Finish ${state.sku} with ${state.pulled_qty} of ${units}? ${units - state.pulled_qty} will be recorded missing.`;
  Alert.alert('No more in this box?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Finish', style: 'destructive', onPress: onConfirm },
  ]);
}

export function promptMissing(
  state: PullLineState,
  onConfirm: (note: string | null) => void,
  setPromptOpen: (open: boolean) => void
) {
  const n = state.actions.length;
  setPromptOpen(true);
  Alert.prompt(
    'Mark as missing?',
    `This closes the pull of ${state.sku}${n > 1 ? ` for ${n} listings` : ''}. Optional note, e.g. which boxes you checked.`,
    [
      { text: 'Cancel', style: 'cancel', onPress: () => setPromptOpen(false) },
      {
        text: 'Mark Missing',
        style: 'destructive',
        onPress: (note?: string) => {
          setPromptOpen(false);
          onConfirm(note?.trim() || null);
        },
      },
    ],
    'plain-text'
  );
}

const ACTION_WORDS = { pull: 'last pull (1 unit)', finish: '“No more in this box”', missing: 'Mark missing' } as const;

/** What an undo will reverse: the server reverses the line's latest accepted event (§5.3). */
export function undoLabel(state: PullLineState): string {
  const stack = getSnapshot().undoStack[state.line_key] ?? [];
  const last = stack[stack.length - 1];
  if (last) {
    return `Undo ${ACTION_WORDS[last.action]}`;
  }
  return state.status === 'missing' ? 'Undo Mark missing' : 'Undo the last action';
}

const REASONS = ['Wrong item scanned', 'Scanned twice', 'Tapped by mistake'];

export function askUndo(
  state: PullLineState,
  onConfirm: (reason: string) => void,
  setPromptOpen: (open: boolean) => void
) {
  const options = [...REASONS, 'Other reason…', 'Cancel'];
  setPromptOpen(true);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `${undoLabel(state)} on ${state.sku}?`,
      message: 'Only to fix a mistake. Why?',
      options,
      cancelButtonIndex: options.length - 1,
    },
    (index) => {
      if (index < REASONS.length) {
        setPromptOpen(false);
        onConfirm(REASONS[index]);
      } else if (index === REASONS.length) {
        Alert.prompt(
          'Reason for the undo',
          undefined,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setPromptOpen(false) },
            {
              text: 'Undo',
              style: 'destructive',
              onPress: (text?: string) => {
                setPromptOpen(false);
                const reason = text?.trim();
                if (reason) {
                  onConfirm(reason);
                }
              },
            },
          ],
          'plain-text'
        );
      } else {
        setPromptOpen(false);
      }
    }
  );
}

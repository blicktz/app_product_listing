import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Scan feedback you can tell apart without looking: a ding plus a success tap
// for a good pick, a warning or error sound plus haptic for anything that
// needs attention.

type Player = ReturnType<typeof createAudioPlayer>;

let dingPlayer: Player | null = null;
let boxOpenPlayer: Player | null = null;
let warningPlayer: Player | null = null;
let errorPlayer: Player | null = null;
let audioReady = false;

/** Call when a picking screen mounts, so the first sound has no delay. */
export function preparePickFeedback() {
  if (!audioReady) {
    audioReady = true;
    // Still audible with the silent switch on, like the camera scan screen.
    void setAudioModeAsync({ playsInSilentMode: true });
  }
  if (!dingPlayer) {
    dingPlayer = createAudioPlayer(require('../../../assets/sounds/ding.mp3'));
  }
  if (!boxOpenPlayer) {
    boxOpenPlayer = createAudioPlayer(require('../../../assets/sounds/box-open.mp3'));
  }
  if (!warningPlayer) {
    warningPlayer = createAudioPlayer(require('../../../assets/sounds/warning.mp3'));
  }
  if (!errorPlayer) {
    errorPlayer = createAudioPlayer(require('../../../assets/sounds/error.mp3'));
  }
}

function replay(p: Player | null) {
  if (p) {
    void p.seekTo(0).then(() => p.play());
  }
}

export function feedbackSuccess() {
  preparePickFeedback();
  replay(dingPlayer);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** A quick double ding: one more unit of something already counted. */
export function feedbackRepeat() {
  feedbackSuccess();
  setTimeout(() => replay(dingPlayer), 160);
}

/** A box was scanned and opened: routine, so short and quieter than a pick. */
export function feedbackBoxOpen() {
  preparePickFeedback();
  replay(boxOpenPlayer);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function feedbackWarning() {
  preparePickFeedback();
  replay(warningPlayer);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export function feedbackError() {
  preparePickFeedback();
  replay(errorPlayer);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Scan feedback you can tell apart without looking: a ding plus a success tap
// for a good pick, warning / error haptics for anything that needs attention.

let player: ReturnType<typeof createAudioPlayer> | null = null;
let audioReady = false;

/** Call when a picking screen mounts, so the first ding has no delay. */
export function preparePickFeedback() {
  if (!audioReady) {
    audioReady = true;
    // Still audible with the silent switch on, like the camera scan screen.
    void setAudioModeAsync({ playsInSilentMode: true });
  }
  if (!player) {
    player = createAudioPlayer(require('../../../assets/sounds/ding.mp3'));
  }
}

export function feedbackSuccess() {
  preparePickFeedback();
  const p = player;
  if (p) {
    void p.seekTo(0).then(() => p.play());
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** A quick double ding: one more unit of something already counted. */
export function feedbackRepeat() {
  feedbackSuccess();
  setTimeout(() => {
    const p = player;
    if (p) {
      void p.seekTo(0).then(() => p.play());
    }
  }, 160);
}

export function feedbackWarning() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export function feedbackError() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

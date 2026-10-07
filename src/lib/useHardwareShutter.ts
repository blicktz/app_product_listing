import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { addShutterListener, setShutterMode, type ShutterMode } from '../../modules/hardware-shutter';

// Same threshold as the Mac relay (mac-remote-trigger/init.lua).
const HOLD_THRESHOLD_MS = 500;

type HardwareShutterOptions = {
  mode: Exclude<ShutterMode, 'off'>;
  onCapture?: () => void;
  onDone?: () => void;
};

// The screen whose mode is currently set natively. Focus/blur order between two
// screens isn't guaranteed, so a blurring screen only turns the shutter off if
// no other screen has claimed it since.
let activeOwner: symbol | null = null;

/**
 * Handles the remote when it is paired to the phone (and the phone's own
 * volume buttons) while the calling screen is focused. Short press -> onCapture,
 * hold -> onDone, mirroring the Mac relay so both paths behave alike. "volume"
 * mode can't see a hold, so every press there is a capture.
 */
export function useHardwareShutter({ mode, onCapture, onDone }: HardwareShutterOptions) {
  const onCaptureRef = useRef(onCapture);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onDoneRef.current = onDone;
  });

  useFocusEffect(
    useCallback(() => {
      const owner = Symbol(mode);
      activeOwner = owner;
      setShutterMode(mode);

      let holdTimer: ReturnType<typeof setTimeout> | null = null;
      let isPressed = false;
      let holdFired = false;

      const cancelHoldTimer = () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      };

      const subscription = addShutterListener(({ type }) => {
        if (type === 'click') {
          onCaptureRef.current?.();
        } else if (type === 'down') {
          if (isPressed) {
            return;
          }
          isPressed = true;
          holdFired = false;
          // Fire "done" as soon as the threshold is reached, so crop/upload
          // starts while the button is still held.
          holdTimer = setTimeout(() => {
            holdTimer = null;
            holdFired = true;
            onDoneRef.current?.();
          }, HOLD_THRESHOLD_MS);
        } else {
          cancelHoldTimer();
          if (type === 'up' && isPressed && !holdFired) {
            onCaptureRef.current?.();
          }
          isPressed = false;
          holdFired = false;
        }
      });

      return () => {
        cancelHoldTimer();
        subscription?.remove();
        if (activeOwner === owner) {
          activeOwner = null;
          setShutterMode('off');
        }
      };
    }, [mode])
  );
}

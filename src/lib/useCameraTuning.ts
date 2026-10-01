import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import {
  getDeviceInfo,
  isCameraTuningAvailable,
  lockExposure,
  lockWhiteBalance,
  resetAuto,
  setExposureBias,
  setManualExposure,
  type CameraTuningInfo,
} from '../../modules/camera-tuning';
import { sleep } from '@/lib/sleep';

// Fixed exposure + white balance for the photo station. iOS auto-exposure
// meters a mostly-white frame down to grey; stock-Camera tests with AE lock at
// +1.5 EV landed on 1/120 s, ISO 64-80, which is the starting point here.
// 1/120 s is also flicker-safe under 60 Hz LED lights.

export type CameraTuningSettings = {
  /** Off = plain iOS auto-exposure / auto-WB, exactly like before. */
  manual: boolean;
  durationSec: number;
  iso: number;
  /** Used only when the lens can't do custom exposure: AE + bias, then lock. */
  ev: number;
  wbLocked: boolean;
  wbTemperatureK: number;
};

export const ISO_STEPS = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400];
export const EV_STEPS = [0, 0.3, 0.7, 1, 1.3, 1.7, 2];

const DEFAULT_SETTINGS: CameraTuningSettings = {
  manual: true,
  durationSec: 1 / 120,
  iso: 100,
  ev: 1.3,
  wbLocked: true,
  wbTemperatureK: 5600,
};

const INFO_POLL_MS = 1000;
// expo-camera swaps the device input a moment after the `selectedLens` prop
// changes, so apply once more after it has landed.
const LENS_SETTLE_MS = 600;
// Time for AE to converge on the new bias before freezing it.
const BIAS_SETTLE_MS = 500;

const settingsFile = new File(Paths.document, 'camera-tuning.json');

function loadSettings(): CameraTuningSettings {
  try {
    if (settingsFile.exists) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(settingsFile.textSync()) };
    }
  } catch (error) {
    console.warn('Could not read camera tuning settings:', error);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: CameraTuningSettings) {
  try {
    if (!settingsFile.exists) {
      settingsFile.create();
    }
    settingsFile.write(JSON.stringify(settings));
  } catch (error) {
    console.warn('Could not save camera tuning settings:', error);
  }
}

async function applySettings(
  lens: string | undefined,
  settings: CameraTuningSettings
): Promise<CameraTuningInfo | null> {
  const current = await getDeviceInfo(lens);
  if (!current || !settings.manual) {
    return resetAuto(lens);
  }

  // Keep an existing WB lock across exposure changes: re-locking samples
  // whatever is in frame (e.g. a colourful product), so only re-measure when
  // the lock was turned on or the device lost it (lens switch, backgrounding).
  const keepWb = settings.wbLocked && current.whiteBalanceMode === 'locked';
  if (!keepWb) {
    // Start from auto so toggling WB off never leaves a stale lock behind.
    await resetAuto(lens);
  }

  let info: CameraTuningInfo | null;
  if (current.supportsCustomExposure) {
    info = await setManualExposure(lens, settings.durationSec, settings.iso);
  } else {
    await setExposureBias(lens, settings.ev);
    await sleep(BIAS_SETTLE_MS);
    info = await lockExposure(lens);
  }

  if (settings.wbLocked && !keepWb) {
    info = await lockWhiteBalance(
      lens,
      current.supportsCustomWhiteBalance ? settings.wbTemperatureK : undefined
    );
  }
  return info;
}

export function useCameraTuning(enabled: boolean, lens: string | undefined, isCameraReady: boolean) {
  const active = enabled && isCameraTuningAvailable && isCameraReady;
  const [settings, setSettings] = useState(loadSettings);
  const [info, setInfo] = useState<CameraTuningInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enabled) {
      saveSettings(settings);
    }
  }, [enabled, settings]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    const apply = () =>
      applySettings(lens, settings)
        .then((next) => {
          if (!cancelled) {
            setInfo(next);
            setError(null);
          }
        })
        .catch((applyError) => {
          console.warn('Camera tuning failed:', applyError);
          if (!cancelled) {
            setError(String(applyError?.message ?? applyError));
          }
        });

    apply();
    const settleTimer = setTimeout(apply, LENS_SETTLE_MS);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        apply();
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
      appStateSub.remove();
    };
  }, [active, lens, settings]);

  // Live readout, so it's visible on screen whether the lock is holding.
  useEffect(() => {
    if (!active) {
      return;
    }
    const poll = setInterval(() => {
      getDeviceInfo(lens)
        .then(setInfo)
        .catch(() => {});
    }, INFO_POLL_MS);
    return () => clearInterval(poll);
  }, [active, lens]);

  // Leave the camera on auto for other screens (e.g. the barcode scanner).
  useEffect(() => {
    if (!active) {
      return;
    }
    return () => {
      resetAuto(lens).catch(() => {});
    };
  }, [active, lens]);

  const update = useCallback((patch: Partial<CameraTuningSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return { available: active, settings, info, error, update };
}

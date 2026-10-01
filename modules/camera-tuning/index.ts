import { requireOptionalNativeModule } from 'expo';

// Manual exposure / white balance for the back camera that <CameraView> is
// running (iOS only). `lensName` is the same string passed to CameraView's
// `selectedLens`; omit it when the app leaves the lens unset.
//
// The native module is optional: on a binary built before this module existed
// (or on Android/web) every call resolves to null and does nothing, so the
// camera screen never crashes because of it.

export type CameraTuningInfo = {
  lensName: string;
  deviceType: string;
  exposureMode: 'locked' | 'auto' | 'continuousAuto' | 'custom' | 'unknown';
  exposureDurationSec: number;
  iso: number;
  bias: number;
  minIso: number;
  maxIso: number;
  minDurationSec: number;
  maxDurationSec: number;
  minBias: number;
  maxBias: number;
  supportsCustomExposure: boolean;
  supportsLockedExposure: boolean;
  whiteBalanceMode: 'locked' | 'auto' | 'continuousAuto' | 'unknown';
  temperatureK: number;
  tint: number;
  supportsCustomWhiteBalance: boolean;
};

type NativeCameraTuning = {
  getDeviceInfo(lensName: string | null): Promise<CameraTuningInfo>;
  setManualExposure(lensName: string | null, durationSec: number, iso: number): Promise<CameraTuningInfo>;
  setExposureBias(lensName: string | null, ev: number): Promise<CameraTuningInfo>;
  lockExposure(lensName: string | null): Promise<CameraTuningInfo>;
  lockWhiteBalance(lensName: string | null, temperatureK: number | null): Promise<CameraTuningInfo>;
  resetAuto(lensName: string | null): Promise<CameraTuningInfo>;
};

const native = requireOptionalNativeModule<NativeCameraTuning>('CameraTuning');

export const isCameraTuningAvailable = native !== null;

export async function getDeviceInfo(lensName?: string): Promise<CameraTuningInfo | null> {
  return native ? native.getDeviceInfo(lensName ?? null) : null;
}

/** Fixed shutter + ISO (clamped to what the lens supports). */
export async function setManualExposure(
  lensName: string | undefined,
  durationSec: number,
  iso: number
): Promise<CameraTuningInfo | null> {
  return native ? native.setManualExposure(lensName ?? null, durationSec, iso) : null;
}

/** Auto-exposure with an EV offset; pair with lockExposure() to freeze it. */
export async function setExposureBias(
  lensName: string | undefined,
  ev: number
): Promise<CameraTuningInfo | null> {
  return native ? native.setExposureBias(lensName ?? null, ev) : null;
}

export async function lockExposure(lensName?: string): Promise<CameraTuningInfo | null> {
  return native ? native.lockExposure(lensName ?? null) : null;
}

/** Lock to a colour temperature, or freeze the current auto-WB when omitted. */
export async function lockWhiteBalance(
  lensName?: string,
  temperatureK?: number
): Promise<CameraTuningInfo | null> {
  return native ? native.lockWhiteBalance(lensName ?? null, temperatureK ?? null) : null;
}

/** Back to continuous auto-exposure (bias 0) and auto white balance. */
export async function resetAuto(lensName?: string): Promise<CameraTuningInfo | null> {
  return native ? native.resetAuto(lensName ?? null) : null;
}

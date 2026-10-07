import { requireOptionalNativeModule, type NativeModule } from 'expo';

// Hardware shutter presses (iOS only): the phone's volume buttons and Bluetooth
// shutter remotes paired to the phone, which send Volume Up.
//
// - "capture": camera screen only (needs a running camera). Reports "down" and
//   "up" separately so a hold can be told apart from a click; "cancel" means
//   the press was interrupted and should be ignored.
// - "volume": any screen. Reports each press as a "click" and resets the volume.
//
// The native module is optional: on a binary built before this module existed
// (or on Android/web) these do nothing, and the Mac relay still works.

export type ShutterMode = 'capture' | 'volume' | 'off';

export type ShutterEvent = { type: 'down' | 'up' | 'cancel' | 'click' };

type HardwareShutterEvents = {
  onShutter(event: ShutterEvent): void;
};

declare class NativeHardwareShutter extends NativeModule<HardwareShutterEvents> {
  setMode(mode: ShutterMode): void;
}

const native = requireOptionalNativeModule<NativeHardwareShutter>('HardwareShutter');

export const isHardwareShutterAvailable = native !== null;

export function setShutterMode(mode: ShutterMode): void {
  native?.setMode(mode);
}

export function addShutterListener(listener: (event: ShutterEvent) => void): { remove(): void } | null {
  return native ? native.addListener('onShutter', listener) : null;
}

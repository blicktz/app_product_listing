import Constants from 'expo-constants';
import type { CameraTuningInfo } from '../../modules/camera-tuning';

// Capture metadata uploaded next to each photo as `{sku}_{nn}.json`, for the
// post-processing on the Mac. The crop in handleDone re-encodes the JPEG and
// strips its EXIF, so this is the only record of how a photo was shot.
//
// `exif` is expo-camera's EXIF dictionary only (ExposureTime, ISO, bias, lens,
// timestamps...). GPS lives in a separate dictionary that expo-camera never
// returns, so no location ends up in here.

export type CaptureMetadata = {
  capturedAt: string;
  /** Normalized CameraView zoom (0-1), as set by pinch. */
  zoom: number;
  lens: string | null;
  exif: Record<string, unknown> | null;
  /** Live exposure / white-balance state of the device at capture. */
  device: CameraTuningInfo | null;
  original: { width: number; height: number };
};

export type PhotoSidecar = CaptureMetadata & {
  schemaVersion: 1;
  appVersion: string | null;
  sku: string;
  filename: string;
  /** How the uploaded JPEG was derived from the original capture. */
  processing: {
    crop: { originX: number; originY: number; width: number; height: number };
    output: { width: number; height: number; format: 'jpeg'; quality: number };
  };
};

export function sidecarFilename(photoFilename: string) {
  return photoFilename.replace(/\.jpg$/i, '.json');
}

export function buildSidecar(
  sku: string,
  filename: string,
  metadata: CaptureMetadata,
  processing: PhotoSidecar['processing']
): PhotoSidecar {
  return {
    schemaVersion: 1,
    appVersion: Constants.expoConfig?.version ?? null,
    sku,
    filename,
    ...metadata,
    processing,
  };
}

import { File, Paths } from 'expo-file-system';

// Last pinch-zoom level on the camera screen, kept across SKUs and app
// restarts so every item is framed the same. Separate from the camera tuning
// settings: those re-apply exposure/WB on change, zoom must not.

const zoomFile = new File(Paths.document, 'camera-zoom.json');

export function loadZoom(): number {
  try {
    if (zoomFile.exists) {
      const zoom = Number(JSON.parse(zoomFile.textSync()));
      if (Number.isFinite(zoom)) {
        return Math.min(Math.max(zoom, 0), 1);
      }
    }
  } catch (error) {
    console.warn('Could not read camera zoom:', error);
  }
  return 0;
}

export function saveZoom(zoom: number) {
  try {
    if (!zoomFile.exists) {
      zoomFile.create();
    }
    zoomFile.write(JSON.stringify(zoom));
  } catch (error) {
    console.warn('Could not save camera zoom:', error);
  }
}

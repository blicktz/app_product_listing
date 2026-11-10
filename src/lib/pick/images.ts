import { Directory, File, Paths } from 'expo-file-system';
import type { PickLine } from './types';

// Cover images cached under Documents/, so rows and the zoom viewer still work
// where the garage Wi-Fi is weak. Each tab has its own folder (pick-images/,
// pack-images/): downloaded on refresh for what is still to do, and files no
// longer needed are removed.

export type ImageCache = {
  /** Local copy when downloaded, else the remote URL (or null without one). */
  uri: (url: string | null | undefined) => string | null;
  prefetch: (urls: string[]) => Promise<void>;
  /** Deletes every cached file not in `keepUrls`. */
  cleanup: (keepUrls: string[]) => void;
};

export function createImageCache(folder: string): ImageCache {
  const dir = new Directory(Paths.document, folder);
  let prefetching = false;

  const fileFor = (url: string): File => {
    // FNV-1a: a stable, filename-safe name per URL.
    let hash = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) {
      hash ^= url.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const ext = /\.(png|webp|jpe?g)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
    return new File(dir, `${(hash >>> 0).toString(16)}.${ext}`);
  };

  return {
    uri(url) {
      if (!url) {
        return null;
      }
      try {
        const file = fileFor(url);
        return file.exists ? file.uri : url;
      } catch {
        return url;
      }
    },

    async prefetch(urls) {
      if (prefetching) {
        return;
      }
      prefetching = true;
      try {
        dir.create({ intermediates: true, idempotent: true });
        for (const url of urls) {
          const file = fileFor(url);
          if (file.exists) {
            continue;
          }
          try {
            await File.downloadFileAsync(url, file, { idempotent: true });
          } catch (error) {
            console.warn(`Could not cache image ${url}:`, error);
          }
        }
      } finally {
        prefetching = false;
      }
    },

    cleanup(keepUrls) {
      try {
        if (!dir.exists) {
          return;
        }
        const keep = new Set(keepUrls.map((url) => fileFor(url).name));
        for (const entry of dir.list()) {
          if (entry instanceof File && !keep.has(entry.name)) {
            entry.delete();
          }
        }
      } catch (error) {
        console.warn(`Could not clean up cached images in ${folder}:`, error);
      }
    },
  };
}

const pickImages = createImageCache('pick-images');

export const imageUri = pickImages.uri;

function lineUrls(line: PickLine): string[] {
  return [line.image_url, line.image_url_full].filter((u): u is string => Boolean(u));
}

export function prefetchImages(lines: PickLine[]): Promise<void> {
  return pickImages.prefetch(lines.flatMap(lineUrls));
}

export function cleanupImages(lines: PickLine[]) {
  pickImages.cleanup(lines.flatMap(lineUrls));
}

import { Directory, File, Paths } from 'expo-file-system';
import type { PickLine } from './types';

// Cover images cached in Documents/pick-images/, so rows and the zoom viewer
// still work where the garage Wi-Fi is weak. Downloaded on each refresh for
// the lines still to pick; files for lines no longer on the list are removed.

const DIR = new Directory(Paths.document, 'pick-images');

function fileFor(url: string): File {
  // FNV-1a: a stable, filename-safe name per URL.
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const ext = /\.(png|webp|jpe?g)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
  return new File(DIR, `${(hash >>> 0).toString(16)}.${ext}`);
}

/** Local copy when downloaded, else the remote URL (or null without one). */
export function imageUri(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const file = fileFor(url);
    return file.exists ? file.uri : url;
  } catch {
    return url;
  }
}

function lineUrls(line: PickLine): string[] {
  return [line.image_url, line.image_url_full].filter((u): u is string => Boolean(u));
}

let prefetching = false;

export async function prefetchImages(lines: PickLine[]): Promise<void> {
  if (prefetching) {
    return;
  }
  prefetching = true;
  try {
    DIR.create({ intermediates: true, idempotent: true });
    for (const url of lines.flatMap(lineUrls)) {
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
}

export function cleanupImages(lines: PickLine[]) {
  try {
    if (!DIR.exists) {
      return;
    }
    const keep = new Set(lines.flatMap(lineUrls).map((url) => fileFor(url).name));
    for (const entry of DIR.list()) {
      if (entry instanceof File && !keep.has(entry.name)) {
        entry.delete();
      }
    }
  } catch (error) {
    console.warn('Could not clean up cached images:', error);
  }
}

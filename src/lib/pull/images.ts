import { createImageCache } from '../pick/images';
import type { PullLine } from './types';

// Pull's own cover-image cache (Documents/pull-images/), separate from Pick's.
// Photos are the SKU's own, served by the Mac (bundle members too).

const pullImages = createImageCache('pull-images');

export const pullImageUri = pullImages.uri;

function lineUrls(line: PullLine): string[] {
  return [line.image_url, line.image_url_full].filter((u): u is string => Boolean(u));
}

export function prefetchImages(lines: PullLine[]): Promise<void> {
  return pullImages.prefetch(lines.flatMap(lineUrls));
}

export function cleanupImages(lines: PullLine[]) {
  pullImages.cleanup(lines.flatMap(lineUrls));
}

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { buildSidecar, sidecarFilename } from '../photoSidecar';
import { LISTING_ENV_FILENAME, buildListingEnv } from '../listingConfig';
import { jobFile, photoFilename, type JobPhoto, type UploadJob } from './store';

export const MAX_OUTPUT_SIZE = 1600;
export const JPEG_QUALITY = 0.9;

function writeText(file: File, content: string) {
  if (!file.exists) {
    file.create();
  }
  file.write(content);
}

/** Center-square crop + resize one capture, write its upload JPEG and sidecar. */
export async function preparePhoto(job: UploadJob, photo: JobPhoto): Promise<void> {
  if (!photo.rawFile) {
    return;
  }
  const raw = jobFile(job.id, photo.rawFile);
  const filename = photoFilename(job.sku, photo.number);

  const size = Math.min(photo.width, photo.height);
  const originX = (photo.width - size) / 2;
  const originY = (photo.height - size) / 2;
  const outputSize = Math.min(size, MAX_OUTPUT_SIZE);

  // Capture metadata sidecar ({sku}_{nn}.json) for post-processing; the crop
  // below re-encodes the JPEG and strips its own EXIF.
  const sidecar = buildSidecar(
    job.sku,
    filename,
    photo.metadata,
    {
      crop: { originX, originY, width: size, height: size },
      output: { width: outputSize, height: outputSize, format: 'jpeg', quality: JPEG_QUALITY },
    },
    job.listing
  );
  writeText(jobFile(job.id, sidecarFilename(filename)), JSON.stringify(sidecar, null, 2));

  const context = ImageManipulator.manipulate(raw.uri);
  context.crop({ originX, originY, width: size, height: size });
  if (size > MAX_OUTPUT_SIZE) {
    context.resize({ width: MAX_OUTPUT_SIZE, height: MAX_OUTPUT_SIZE });
  }
  const rendered = await context.renderAsync();
  const cropped = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });

  // The manipulator writes into cache; move the result into the durable job dir.
  new File(cropped.uri).moveSync(jobFile(job.id, filename), { overwrite: true });
  raw.delete();
  photo.rawFile = null;
}

export function prepareListingEnv(job: UploadJob) {
  if (job.listing) {
    writeText(jobFile(job.id, LISTING_ENV_FILENAME), buildListingEnv(job.listing));
  }
}

export type UploadFile = { filename: string; contentType: string };

/** Every file a prepared job uploads, in upload order. */
export function jobUploadFiles(job: UploadJob): UploadFile[] {
  const files: UploadFile[] = [];
  if (job.listing) {
    files.push({ filename: LISTING_ENV_FILENAME, contentType: 'text/plain' });
  }
  for (const photo of job.photos) {
    const filename = photoFilename(job.sku, photo.number);
    files.push({ filename, contentType: 'image/jpeg' });
    files.push({ filename: sidecarFilename(filename), contentType: 'application/json' });
  }
  return files;
}

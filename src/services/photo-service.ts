/**
 * Accept, validate, sanitise and store listing photos.
 *
 * The order of operations matters and is deliberate:
 *
 *   1. Validate from the file's own bytes, never the declared content type.
 *   2. Read EXIF — capture point and time — for fraud detection.
 *   3. Strip all metadata from the bytes that will be stored.
 *   4. Store under a random key.
 *
 * Step 2 before step 3 is the whole point: the platform keeps the fraud signal,
 * the published file does not carry the farm's coordinates.
 */

import { type ExifData, readExif, stripMetadata } from '../lib/exif';
import { type ObjectStorage, storage } from '../lib/storage';
import {
  MAX_PHOTOS_PER_LISTING,
  type MediaRejection,
  storageKey,
  validateImage,
} from '../domain/media/validation';

export class PhotoError extends Error {
  constructor(
    message: string,
    readonly reason: MediaRejection | 'STORAGE_FAILED',
    readonly index?: number,
  ) {
    super(message);
    this.name = 'PhotoError';
  }
}

export interface StoredPhoto {
  url: string;
  key: string;
  bytes: number;
  /** Kept for fraud checks; never rendered to a buyer. */
  exif: ExifData;
}

export async function storeListingPhotos(
  files: File[],
  args: { sellerId: string; store?: ObjectStorage },
): Promise<StoredPhoto[]> {
  if (files.length > MAX_PHOTOS_PER_LISTING) {
    throw new PhotoError(
      `At most ${MAX_PHOTOS_PER_LISTING} photos per listing`,
      'TOO_MANY',
    );
  }

  const store = args.store ?? (await storage());
  const stored: StoredPhoto[] = [];

  for (const [index, file] of files.entries()) {
    const raw = new Uint8Array(await file.arrayBuffer());

    const verdict = validateImage(raw);
    if (!verdict.ok || !verdict.format) {
      throw new PhotoError(
        verdict.detail ?? 'That file is not a supported image',
        verdict.reason ?? 'UNKNOWN_FORMAT',
        index,
      );
    }

    // Read before stripping — afterwards there is nothing left to read.
    const exif = readExif(raw);
    const sanitised = stripMetadata(raw);

    try {
      const object = await store.put({
        key: storageKey({ sellerId: args.sellerId, format: verdict.format }),
        body: sanitised,
        format: verdict.format,
      });
      stored.push({ url: object.url, key: object.key, bytes: object.bytes, exif });
    } catch (error) {
      // Do not surface storage internals — bucket names and endpoints are not
      // the caller's business.
      console.error('Photo upload failed', error);
      throw new PhotoError('Could not save that photo. Please try again.', 'STORAGE_FAILED', index);
    }
  }

  return stored;
}

/**
 * Distance in km between a photo's capture point and the farm.
 *
 * Used for the EXIF_LOCATION_MISMATCH flag (§8.3). Returns null when either
 * point is unknown, which is the common case — most photos arriving from the
 * app have already lost their EXIF to canvas re-encoding, and an absent signal
 * is not a suspicious one.
 */
export function captureDistanceKm(
  exif: ExifData,
  farm: { lat: number; lng: number } | null,
): number | null {
  if (!farm || exif.latitude === undefined || exif.longitude === undefined) return null;

  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(farm.lat - exif.latitude);
  const dLng = toRad(farm.lng - exif.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(exif.latitude)) * Math.cos(toRad(farm.lat));

  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Beyond this, the photo was probably not taken at the farm being listed. */
export const LOCATION_MISMATCH_KM = 100;

/** Older than this, the photo is probably recycled from a previous sale. */
export const STALE_PHOTO_DAYS = 180;

export interface PhotoSuspicion {
  locationMismatchKm?: number;
  stalePhotoDays?: number;
}

export function assessPhotos(
  photos: StoredPhoto[],
  farm: { lat: number; lng: number } | null,
  now = new Date(),
): PhotoSuspicion {
  const suspicion: PhotoSuspicion = {};

  for (const photo of photos) {
    const distance = captureDistanceKm(photo.exif, farm);
    if (distance !== null && distance > LOCATION_MISMATCH_KM) {
      suspicion.locationMismatchKm = Math.max(suspicion.locationMismatchKm ?? 0, distance);
    }

    if (photo.exif.capturedAt) {
      const ageDays = (now.getTime() - photo.exif.capturedAt.getTime()) / 86_400_000;
      if (ageDays > STALE_PHOTO_DAYS) {
        suspicion.stalePhotoDays = Math.max(suspicion.stalePhotoDays ?? 0, Math.round(ageDays));
      }
    }
  }

  return suspicion;
}

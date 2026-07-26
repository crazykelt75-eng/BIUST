/**
 * Upload validation.
 *
 * User-supplied files are the highest-risk input this application takes, and
 * the mistake almost everyone makes is trusting the client. Two things arrive
 * with an upload and neither is evidence of anything:
 *
 *   - `Content-Type`, which the client simply asserts
 *   - the filename extension, which the client also simply asserts
 *
 * So the format is determined by sniffing the leading bytes, and the declared
 * type is used only to reject early. A `.jpg` that is actually an HTML file
 * gets served back as HTML by a naive CDN and becomes stored XSS; a `.jpg` that
 * is a 2 GB zip bomb becomes a denial of service.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** 8 MB. A compressed phone photo is well under 1 MB; this is generous. */
export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_BYTES = 512;
export const MAX_PHOTOS_PER_LISTING = 12;

export type MediaRejection =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'TOO_SMALL'
  | 'UNKNOWN_FORMAT'
  | 'TOO_MANY';

export interface MediaVerdict {
  ok: boolean;
  format?: ImageFormat;
  reason?: MediaRejection;
  detail?: string;
}

/**
 * Identify the format from the file's own bytes.
 *
 * Returns null for anything not on the allowlist. An allowlist rather than a
 * blocklist: the set of things that are safe to serve as an image is small and
 * known, and the set of things that are dangerous is not.
 */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngMagic.every((b, i) => bytes[i] === b)) return 'png';

  // WebP: "RIFF" .... "WEBP"
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp';

  return null;
}

export function validateImage(bytes: Uint8Array): MediaVerdict {
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  if (bytes.length < MIN_BYTES) {
    return { ok: false, reason: 'TOO_SMALL', detail: `${bytes.length} bytes` };
  }
  if (bytes.length > MAX_BYTES) {
    return {
      ok: false,
      reason: 'TOO_LARGE',
      detail: `${(bytes.length / 1024 / 1024).toFixed(1)} MB, limit ${MAX_BYTES / 1024 / 1024} MB`,
    };
  }

  const format = sniffFormat(bytes);
  if (!format) {
    return {
      ok: false,
      reason: 'UNKNOWN_FORMAT',
      detail: 'Only JPEG, PNG and WebP images are accepted',
    };
  }

  return { ok: true, format };
}

export function contentTypeFor(format: ImageFormat): string {
  return { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format];
}

export function extensionFor(format: ImageFormat): string {
  return { jpeg: 'jpg', png: 'png', webp: 'webp' }[format];
}

/**
 * Storage key for a listing photo.
 *
 * Random rather than sequential. Sequential keys let anyone who sees one photo
 * URL enumerate every other listing's photos, including from listings that were
 * suspended for fraud.
 */
export function storageKey(args: {
  sellerId: string;
  format: ImageFormat;
  random?: string;
}): string {
  const random =
    args.random ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const shard = random.slice(0, 2);
  return `listings/${shard}/${random}.${extensionFor(args.format)}`;
}

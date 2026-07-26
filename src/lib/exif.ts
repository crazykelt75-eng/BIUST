/**
 * EXIF: read it, then remove it.
 *
 * These two requirements pull in opposite directions and both are in the spec.
 *
 *   - §8.3 wants capture location and time for fraud detection. A photo whose
 *     GPS puts it 400 km from the seller's farm, or whose timestamp is three
 *     years old, is a signal that the animals in it are not the animals being
 *     sold.
 *
 *   - §4.3 says a farm's exact location is never exposed to buyers who have not
 *     committed. A photo with GPS intact hands over the precise coordinates of
 *     a cattle post to anyone who downloads it — which, given that stock theft
 *     is the dominant fraud in this market, is a genuinely dangerous thing to
 *     publish.
 *
 * So: extract server-side into the database where only the platform can see it,
 * strip it from the bytes that get stored and served. The fraud signal is kept
 * and the farm's coordinates are not published.
 *
 * Note that the client already re-encodes photos through a canvas, which drops
 * EXIF as a side effect. That is convenient but it is not a control — anything
 * posting directly to the API bypasses it — so the server strips regardless.
 */

export interface ExifData {
  latitude?: number;
  longitude?: number;
  capturedAt?: Date;
}

const SOI = 0xd8;
const APP1 = 0xe1;
const SOS = 0xda;

/**
 * Extract capture location and time from a JPEG.
 *
 * Returns an empty object for anything without usable EXIF, including PNG and
 * WebP. Never throws: a malformed or hostile EXIF block must not be able to
 * fail an upload, let alone crash the request.
 */
export function readExif(bytes: Uint8Array): ExifData {
  try {
    return parseExif(bytes);
  } catch {
    return {};
  }
}

function parseExif(bytes: Uint8Array): ExifData {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return {};

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === SOS) break;

    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) break;

    if (marker === APP1) {
      const header = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (header === 'Exif') {
        return parseTiff(bytes, offset + 10, length - 8);
      }
    }

    offset += 2 + length;
  }

  return {};
}

function parseTiff(bytes: Uint8Array, start: number, maxLength: number): ExifData {
  if (start + 8 > bytes.length) return {};

  const byteOrder = String.fromCharCode(bytes[start]!, bytes[start + 1]!);
  const little = byteOrder === 'II';
  if (!little && byteOrder !== 'MM') return {};

  const view = new DataView(bytes.buffer, bytes.byteOffset + start, Math.min(maxLength, bytes.length - start));

  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);

  if (u16(2) !== 0x002a) return {};

  const ifd0 = u32(4);
  const result: ExifData = {};

  const entries = readIfd(view, ifd0, little);

  const gpsPointer = entries.get(0x8825);
  if (gpsPointer !== undefined) {
    const gps = readIfd(view, gpsPointer, little);
    const coords = readGps(view, gps, little);
    if (coords) {
      result.latitude = coords.latitude;
      result.longitude = coords.longitude;
    }
  }

  const exifPointer = entries.get(0x8769);
  if (exifPointer !== undefined) {
    const exif = readIfd(view, exifPointer, little);
    // 0x9003 DateTimeOriginal — when the shutter fired, not when the file was
    // last written, which is what makes it useful against recycled photos.
    const dateOffset = exif.get(0x9003);
    if (dateOffset !== undefined) {
      const raw = readAscii(view, dateOffset, 19);
      const parsed = parseExifDate(raw);
      if (parsed) result.capturedAt = parsed;
    }
  }

  return result;
}

/**
 * Read one IFD into tag → value-or-offset.
 *
 * Values of four bytes or fewer are stored inline; longer ones are a pointer.
 * For the tags used here the distinction does not change the return shape, so
 * callers get the raw 32-bit field and interpret it per tag.
 */
function readIfd(view: DataView, offset: number, little: boolean): Map<number, number> {
  const result = new Map<number, number>();
  if (offset + 2 > view.byteLength) return result;

  const count = view.getUint16(offset, little);
  // A hostile file can claim an implausible entry count; cap the work.
  const limit = Math.min(count, 256);

  for (let i = 0; i < limit; i++) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    result.set(tag, view.getUint32(entry + 8, little));
  }

  return result;
}

function readGps(
  view: DataView,
  gps: Map<number, number>,
  little: boolean,
): { latitude: number; longitude: number } | null {
  const latOffset = gps.get(0x0002);
  const lonOffset = gps.get(0x0004);
  const latRef = gps.get(0x0001);
  const lonRef = gps.get(0x0003);
  if (latOffset === undefined || lonOffset === undefined) return null;

  const latitude = readRationalDms(view, latOffset, little);
  const longitude = readRationalDms(view, lonOffset, little);
  if (latitude === null || longitude === null) return null;

  // Refs are 2-byte inline ASCII: 'N'/'S', 'E'/'W'.
  const south = (latRef ?? 0) >>> 24 === 0x53 || String.fromCharCode((latRef ?? 0) & 0xff) === 'S';
  const west = (lonRef ?? 0) >>> 24 === 0x57 || String.fromCharCode((lonRef ?? 0) & 0xff) === 'W';

  const lat = south ? -latitude : latitude;
  const lon = west ? -longitude : longitude;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return { latitude: lat, longitude: lon };
}

/** Three rationals: degrees, minutes, seconds. */
function readRationalDms(view: DataView, offset: number, little: boolean): number | null {
  if (offset + 24 > view.byteLength) return null;

  const parts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const numerator = view.getUint32(offset + i * 8, little);
    const denominator = view.getUint32(offset + i * 8 + 4, little);
    if (denominator === 0) return null;
    parts.push(numerator / denominator);
  }

  return parts[0]! + parts[1]! / 60 + parts[2]! / 3600;
}

function readAscii(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) return '';
  let out = '';
  for (let i = 0; i < length; i++) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** EXIF dates look like "2026:07:26 14:32:11". */
function parseExifDate(raw: string): Date | null {
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Remove every metadata segment from a JPEG.
 *
 * Drops APP0–APP15 and comments, which covers EXIF, XMP, Photoshop IRB and the
 * various vendor blocks — several of which carry GPS independently, so removing
 * only APP1 is not enough.
 *
 * PNG and WebP pass through unchanged: the client re-encodes to WebP through a
 * canvas, which does not carry metadata forward.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return bytes;

  const kept: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;

    if (marker === SOS) {
      // Everything from here is compressed image data; copy it verbatim.
      kept.push(bytes.slice(offset));
      offset = bytes.length;
      break;
    }

    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) break;

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) {
      kept.push(bytes.slice(offset, offset + 2 + length));
    }

    offset += 2 + length;
  }

  if (offset < bytes.length) kept.push(bytes.slice(offset));

  const total = kept.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of kept) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }

  return out;
}

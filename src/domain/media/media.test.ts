import { describe, expect, it } from 'vitest';

import { readExif, stripMetadata } from '../../lib/exif';
import {
  MAX_BYTES,
  sniffFormat,
  storageKey,
  validateImage,
} from './validation';

/** Minimal but structurally valid file headers. */
function jpeg(extra: number[] = []): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...extra, ...pad(600)]);
}
function png(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...pad(600)]);
}
function webp(): Uint8Array {
  const riff = [...'RIFF'].map((c) => c.charCodeAt(0));
  const wp = [...'WEBP'].map((c) => c.charCodeAt(0));
  return new Uint8Array([...riff, 0, 0, 0, 0, ...wp, ...pad(600)]);
}
function pad(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i % 256);
}

describe('format sniffing', () => {
  it('identifies the allowed formats from their own bytes', () => {
    expect(sniffFormat(jpeg())).toBe('jpeg');
    expect(sniffFormat(png())).toBe('png');
    expect(sniffFormat(webp())).toBe('webp');
  });

  it('rejects a file that merely claims to be an image', () => {
    // The classic stored-XSS route: an HTML file named photo.jpg, served back
    // as HTML by a CDN that trusts the extension.
    const html = new Uint8Array([...'<html><script>'].map((c) => c.charCodeAt(0)).concat(pad(600)));
    expect(sniffFormat(html)).toBeNull();
    expect(validateImage(html).ok).toBe(false);
  });

  it('rejects an SVG, which is a script container', () => {
    const svg = new Uint8Array([...'<svg xmlns='].map((c) => c.charCodeAt(0)).concat(pad(600)));
    expect(sniffFormat(svg)).toBeNull();
  });

  it('rejects a zip disguised as a photo', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...pad(600)]);
    expect(sniffFormat(zip)).toBeNull();
  });

  it('rejects truncated input rather than reading past the end', () => {
    expect(sniffFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffFormat(new Uint8Array([]))).toBeNull();
  });
});

describe('size limits', () => {
  it('rejects an empty file', () => {
    expect(validateImage(new Uint8Array([])).reason).toBe('EMPTY');
  });

  it('rejects something too small to be a real photo', () => {
    expect(validateImage(new Uint8Array([0xff, 0xd8, 0xff])).reason).toBe('TOO_SMALL');
  });

  it('rejects oversized uploads', () => {
    const huge = new Uint8Array(MAX_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff]);
    expect(validateImage(huge).reason).toBe('TOO_LARGE');
  });

  it('accepts an ordinary photo', () => {
    const verdict = validateImage(jpeg());
    expect(verdict.ok).toBe(true);
    expect(verdict.format).toBe('jpeg');
  });
});

describe('storage keys', () => {
  it('are random, not sequential', () => {
    // Sequential keys let anyone with one photo URL enumerate every listing's
    // photos, including listings suspended for fraud.
    const keys = new Set(
      Array.from({ length: 200 }, () => storageKey({ sellerId: 'u1', format: 'jpeg' })),
    );
    expect(keys.size).toBe(200);
  });

  it('do not leak the seller id', () => {
    const key = storageKey({ sellerId: 'user-mpho-secret', format: 'jpeg' });
    expect(key).not.toContain('mpho');
  });

  it('carry the right extension', () => {
    expect(storageKey({ sellerId: 'u', format: 'webp', random: 'abcd' })).toBe(
      'listings/ab/abcd.webp',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXIF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A JPEG carrying an APP1 EXIF block with GPS and a capture date.
 *
 * Hand-built rather than fixture-loaded so the byte layout is visible: the test
 * is checking a binary parser, and a fixture would hide exactly the thing under
 * test.
 */
function jpegWithExif(): Uint8Array {
  const tiff: number[] = [];
  const push32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  const push16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);

  // Little-endian TIFF header
  tiff.push(0x49, 0x49);
  push16(0x002a);
  push32(8);

  // Layout, computed rather than guessed — the first version of this fixture
  // declared the Exif IFD at an offset where the GPS coordinates actually sat.
  //   IFD0      8 .. 37   (count 2 + 2 entries x 12 + next 4)
  //   GPS IFD  38 .. 91   (count 2 + 4 entries x 12 + next 4)
  //   Exif IFD 92 .. 109  (count 2 + 1 entry x 12 + next 4)
  //   latitude    112 .. 135
  //   longitude   136 .. 159
  //   date        160 .. 179
  push16(2);
  push16(0x8825); push16(4); push32(1); push32(38);
  push16(0x8769); push16(4); push32(1); push32(92);
  push32(0);

  // GPS IFD
  push16(4);
  push16(0x0001); push16(2); push32(2); tiff.push(0x53, 0, 0, 0); // 'S'
  push16(0x0002); push16(5); push32(3); push32(112);
  push16(0x0003); push16(2); push32(2); tiff.push(0x45, 0, 0, 0); // 'E'
  push16(0x0004); push16(5); push32(3); push32(136);
  push32(0);

  // Exif IFD
  push16(1);
  push16(0x9003); push16(2); push32(20); push32(160);
  push32(0);

  while (tiff.length < 112) tiff.push(0);
  // Latitude 22 deg 23' 15" S -> -22.3875 (Serowe)
  push32(22); push32(1); push32(23); push32(1); push32(15); push32(1);
  while (tiff.length < 136) tiff.push(0);
  // Longitude 26 deg 42' 39" E -> 26.7108
  push32(26); push32(1); push32(42); push32(1); push32(39); push32(1);
  while (tiff.length < 160) tiff.push(0);
  for (const c of '2026:07:26 14:32:11\0') tiff.push(c.charCodeAt(0));

  const app1Payload = [...'Exif'.split('').map((c) => c.charCodeAt(0)), 0, 0, ...tiff];
  const app1Length = app1Payload.length + 2;

  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff, ...app1Payload,
    0xff, 0xda, 0x00, 0x02, ...pad(400),
  ]);
}

describe('reading EXIF', () => {
  it('extracts GPS coordinates', () => {
    const exif = readExif(jpegWithExif());
    expect(exif.latitude).toBeCloseTo(-22.3875, 3);
    expect(exif.longitude).toBeCloseTo(26.7108, 3);
  });

  it('extracts the capture time', () => {
    const exif = readExif(jpegWithExif());
    expect(exif.capturedAt?.toISOString()).toBe('2026-07-26T14:32:11.000Z');
  });

  it('returns nothing for a photo without EXIF', () => {
    expect(readExif(jpeg())).toEqual({});
    expect(readExif(webp())).toEqual({});
  });

  it('never throws on malformed or hostile input', () => {
    // A bad EXIF block must not be able to fail an upload, let alone crash it.
    const truncated = jpegWithExif().slice(0, 40);
    expect(() => readExif(truncated)).not.toThrow();

    const lying = jpegWithExif();
    lying[4] = 0xff; // absurd segment length
    lying[5] = 0xff;
    expect(() => readExif(lying)).not.toThrow();

    expect(() => readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).not.toThrow();
    expect(() => readExif(new Uint8Array(0))).not.toThrow();
  });
});

describe('stripping metadata', () => {
  it('removes the GPS coordinates from the stored bytes', () => {
    const original = jpegWithExif();
    expect(readExif(original).latitude).toBeDefined();

    const stripped = stripMetadata(original);

    // The published photo must not geolocate the farm. Stock theft is the
    // dominant fraud in this market and a cattle post's exact coordinates are
    // a genuinely dangerous thing to hand out.
    expect(readExif(stripped)).toEqual({});
    expect(stripped.length).toBeLessThan(original.length);
  });

  it('keeps the image data intact', () => {
    const original = jpegWithExif();
    const stripped = stripMetadata(original);

    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    // Scan marker and everything after it survives.
    const sos = findMarker(stripped, 0xda);
    expect(sos).toBeGreaterThan(-1);
  });

  it('leaves non-JPEG formats alone', () => {
    const original = webp();
    expect(stripMetadata(original)).toEqual(original);
  });

  it('is safe on garbage input', () => {
    expect(() => stripMetadata(new Uint8Array([1, 2, 3]))).not.toThrow();
    expect(() => stripMetadata(new Uint8Array(0))).not.toThrow();
  });
});

function findMarker(bytes: Uint8Array, marker: number): number {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === marker) return i;
  }
  return -1;
}

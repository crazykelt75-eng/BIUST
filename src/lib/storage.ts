/**
 * Object storage for listing photos.
 *
 * An interface with two implementations, because the alternative — reaching for
 * an S3 client directly in the route — makes the upload path untestable without
 * a network and makes local development need cloud credentials.
 *
 * Photos are stored already-stripped of metadata (see exif.ts). Nothing written
 * here should ever contain a farm's coordinates.
 */

import { type ImageFormat, contentTypeFor } from '../domain/media/validation';

export interface StoredObject {
  key: string;
  url: string;
  bytes: number;
}

export interface ObjectStorage {
  put(args: { key: string; body: Uint8Array; format: ImageFormat }): Promise<StoredObject>;
  publicUrl(key: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-compatible
// ─────────────────────────────────────────────────────────────────────────────

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** CDN origin in front of the bucket. Falls back to the endpoint. */
  publicBaseUrl?: string;
}

/**
 * Minimal S3 PUT with SigV4, over fetch.
 *
 * Deliberately not the AWS SDK: this needs one operation, and the SDK is a
 * large dependency to carry into a serverless function for a single PUT. If the
 * surface grows past put-and-serve, revisit that.
 */
export class S3Storage implements ObjectStorage {
  constructor(private readonly config: S3Config) {}

  async put(args: { key: string; body: Uint8Array; format: ImageFormat }): Promise<StoredObject> {
    const url = `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${args.key}`;
    const contentType = contentTypeFor(args.format);
    const payloadHash = await sha256Hex(args.body);

    const headers = await signRequest({
      method: 'PUT',
      url,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      payloadHash,
      headers: {
        'content-type': contentType,
        // Photos are content-addressed by a random key and never mutated, so
        // they can be cached indefinitely.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: args.body as unknown as BodyInit,
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }

    return { key: args.key, url: this.publicUrl(args.key), bytes: args.body.length };
  }

  publicUrl(key: string): string {
    const base = this.config.publicBaseUrl ?? `${this.config.endpoint}/${this.config.bucket}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SigV4
// ─────────────────────────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signRequest(args: {
  method: string;
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  headers: Record<string, string>;
}): Promise<Record<string, string>> {
  const url = new URL(args.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    ...args.headers,
    host: url.host,
    'x-amz-content-sha256': args.payloadHash,
    'x-amz-date': amzDate,
  };

  const sortedNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${headers[name] ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === name)!]}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    args.method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    args.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${args.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const encoder = new TextEncoder();
  let signingKey = await hmac(encoder.encode(`AWS4${args.secretAccessKey}`), dateStamp);
  signingKey = await hmac(signingKey, args.region);
  signingKey = await hmac(signingKey, 's3');
  signingKey = await hmac(signingKey, 'aws4_request');

  const signature = toHex(await hmac(signingKey, stringToSign));

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

let cached: ObjectStorage | null = null;

/**
 * The configured storage backend.
 *
 * Falls back to the local filesystem when S3 is not configured, so a fresh
 * checkout runs without cloud credentials. In production that fallback is a
 * misconfiguration, not a convenience, so it refuses.
 */
export async function storage(): Promise<ObjectStorage> {
  if (cached) return cached;

  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    cached = new S3Storage({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: process.env.S3_REGION ?? 'us-east-1',
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    });
    return cached;
  }

  // Production must never silently write photos to a container filesystem that
  // vanishes on the next deploy.
  if (process.env.NODE_ENV === 'production') {
    // Explicit opt-in for live testing on a machine that has a disk. This can
    // never work on Cloudflare Workers (no filesystem — R2 is required there);
    // it exists for `next start` on a VPS or a local production build.
    if (process.env.ALLOW_LOCAL_STORAGE === 'true') {
      console.warn(
        '[storage] ALLOW_LOCAL_STORAGE is enabled in production. Photos are ' +
          'being written to the local disk and will NOT survive a redeploy. ' +
          'This is for LIVE TESTING ONLY.',
      );
      cached = await localStorage();
      return cached;
    }
    throw new Error(
      'Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, ' +
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY — or ALLOW_LOCAL_STORAGE=true ' +
        'for a disk-backed test deployment only.',
    );
  }

  cached = await localStorage();
  return cached;
}

/**
 * Filesystem-backed storage for local development and tests.
 *
 * Loaded through a dynamic import so `node:fs` never enters the Cloudflare
 * Workers bundle. A static import here would be pulled in by the bundler
 * regardless of whether the branch is reachable, and the deploy would fail.
 */
export async function localStorage(root?: string): Promise<ObjectStorage> {
  const { LocalStorage } = await import('./storage-local');
  // public/uploads so Next serves the files statically in a local test build.
  return new LocalStorage(root ?? process.env.LOCAL_STORAGE_DIR ?? 'public/uploads');
}

/** Test seam. */
export function setStorage(next: ObjectStorage | null): void {
  cached = next;
}

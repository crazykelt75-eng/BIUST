/**
 * Filesystem storage — development and tests only.
 *
 * Kept in its own module and imported dynamically (see storage.ts) so that
 * `node:fs` never reaches the Cloudflare Workers bundle.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import type { ImageFormat } from '../domain/media/validation';
import type { ObjectStorage, StoredObject } from './storage';

export class LocalStorage implements ObjectStorage {
  constructor(
    private readonly root: string,
    private readonly baseUrl: string = '/uploads',
  ) {}

  async put(args: { key: string; body: Uint8Array; format: ImageFormat }): Promise<StoredObject> {
    const path = this.resolveWithin(args.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, args.body);
    return { key: args.key, url: this.publicUrl(args.key), bytes: args.body.length };
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Refuse to write outside the storage root.
   *
   * Keys are generated server-side, so traversal should be impossible — but
   * "should be impossible" is how directory traversal keeps happening, and the
   * check costs nothing.
   */
  private resolveWithin(key: string): string {
    const root = resolve(this.root);
    const path = resolve(join(root, normalize(key)));
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`Refusing to write outside the storage root: ${key}`);
    }
    return path;
  }
}

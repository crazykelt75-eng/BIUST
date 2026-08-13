import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapts the Next.js server build to the Workers runtime.
 *
 * Incremental cache is left at its default (in-memory, per-isolate) for now.
 * Every page in this app is `force-dynamic` — listings change constantly and a
 * farmer looking at a sold animal is worse than a slightly slower page — so
 * there is nothing to cache yet. Wire the R2 or KV cache when static pages
 * appear.
 */
export default defineCloudflareConfig();

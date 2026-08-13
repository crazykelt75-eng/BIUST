/**
 * Where the Prisma client comes from — Node build.
 *
 * This indirection exists for one reason: `@prisma/client` appears in Next's
 * DEFAULT `serverExternalPackages` list, so Next never bundles it and a
 * `resolve.alias` on that specifier is silently ignored. A local module is not
 * externalised, so it can be aliased — see next.config.mjs, which swaps this
 * file for `prisma-client.workers.ts` when building for Cloudflare.
 *
 * The two clients are generated from the same schema and differ only in how
 * they load their WASM query compiler: this one reads it off disk, which is
 * right for Node and impossible on Workers.
 *
 * Import from here rather than from '@prisma/client' directly, or the swap
 * will not happen and the worker will fail at query time with
 * "[unenv] fs.readFileSync is not implemented yet".
 */
export { Prisma, PrismaClient } from '@prisma/client';

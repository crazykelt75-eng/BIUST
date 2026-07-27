import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two Prisma clients, one import path.
 *
 * `@prisma/client` loads its WASM query compiler with fs.readFileSync, which
 * is correct under Node and impossible on Cloudflare Workers — there is no
 * filesystem there. It fails at query time rather than build time, so the
 * failure arrives as a 500 from a deployment that built and deployed cleanly.
 *
 * prisma/schema.prisma therefore generates a second, Workers-targeted client
 * that imports the .wasm as a module, and this alias swaps it in for the
 * Cloudflare build only. `next dev`, the seed and the integration tests keep
 * the Node client.
 *
 * The alias is on src/db/prisma-client.ts and NOT on '@prisma/client'
 * directly, which does not work: '@prisma/client' is in Next's default
 * serverExternalPackages list, so Next leaves it external and never consults
 * resolve.alias for it. Aliasing it appears to succeed and changes nothing —
 * the build output still contains the readFileSync loader. A first-party
 * module has no such exemption.
 *
 * CF_WORKERS is set by the cf:build script rather than inferred, because a
 * build that silently picks a different database client depending on its
 * environment should be visible in package.json.
 */
const buildingForWorkers = process.env.CF_WORKERS === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Setswana content and BWP formatting; keep output deterministic.
  experimental: { typedRoutes: true },

  webpack: (config) => {
    if (buildingForWorkers) {
      config.resolve.alias = {
        ...config.resolve.alias,
        [path.resolve(here, 'src/db/prisma-client.ts')]: path.resolve(
          here,
          'src/db/prisma-client.workers.ts',
        ),
      };

      // The Workers client does `import("./query_compiler_bg.wasm?module")`.
      // Webpack 5 does not handle WebAssembly without being asked, and the
      // `?module` suffix is a Cloudflare convention it has never heard of, so
      // it tries to parse two megabytes of WASM as JavaScript and fails at
      // the first byte.
      config.experiments = { ...config.experiments, asyncWebAssembly: true };
      config.module.rules.push({
        test: /\.wasm$/,
        type: 'webassembly/async',
      });
    }
    return config;
  },
};

export default nextConfig;

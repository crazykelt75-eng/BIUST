import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Integration tests share one database; running them in parallel would
    // have each suite truncating tables out from under the others.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});

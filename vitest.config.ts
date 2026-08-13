import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need a live PostgreSQL + PostGIS database and run from
    // their own config. `npm test` must stay runnable on a fresh checkout.
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

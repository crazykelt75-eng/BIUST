#!/usr/bin/env node
/**
 * Bundle budget guard.
 *
 * MASTER_PROMPT.md §3.5 sets a hard limit of 500 KB initial JS, because this
 * runs on a mid-range Android over 2G and every kilobyte is a farmer's prepaid
 * data. Budgets that are not enforced erode one convenient dependency at a
 * time, so this fails the build rather than printing a warning nobody reads.
 *
 * Measures UNCOMPRESSED bytes, which is deliberately the stricter reading.
 * Transfer cost scales with the compressed size, but parse and execute time on
 * a low-end Android scales with the uncompressed size — and on those devices
 * the CPU, not the network, is usually what makes a page feel dead. Next's own
 * "First Load JS" figure is post-compression and will read roughly a third of
 * this.
 *
 * Run after `next build`.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_BYTES = 500 * 1024;
const NEXT_DIR = '.next';

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(NEXT_DIR, 'app-build-manifest.json'), 'utf8'));
} catch {
  console.error('No build manifest found. Run `next build` first.');
  process.exit(1);
}

const sizeOf = (file) => {
  try {
    return statSync(join(NEXT_DIR, file)).size;
  } catch {
    return 0;
  }
};

let worst = { route: null, bytes: 0 };
const rows = [];

for (const [route, files] of Object.entries(manifest.pages ?? {})) {
  const bytes = [...new Set(files)]
    .filter((f) => f.endsWith('.js'))
    .reduce((sum, f) => sum + sizeOf(f), 0);
  rows.push({ route, bytes });
  if (bytes > worst.bytes) worst = { route, bytes };
}

rows.sort((a, b) => b.bytes - a.bytes);
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;

for (const row of rows) {
  const marker = row.bytes > BUDGET_BYTES ? '✗' : '✓';
  console.log(`${marker} ${row.route.padEnd(28)} ${kb(row.bytes)}`);
}

console.log(`\nBudget: ${kb(BUDGET_BYTES)} — worst route ${worst.route} at ${kb(worst.bytes)}`);

if (worst.bytes > BUDGET_BYTES) {
  console.error(
    `\nFAIL: ${worst.route} ships ${kb(worst.bytes)}, over the ${kb(BUDGET_BYTES)} budget.\n` +
      'Test on throttled 2G before raising this number.',
  );
  process.exit(1);
}

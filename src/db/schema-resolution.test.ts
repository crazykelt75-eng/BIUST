import { afterEach, describe, expect, it } from 'vitest';

import { resolveSchema } from './client';

/**
 * These guard a failure that is silent rather than loud.
 *
 * Kraal shares a Supabase database with an unrelated application living in
 * `public`. Prisma schema-qualifies its generated queries and defaults to
 * `public`, so if the schema is not named, a perfectly healthy-looking
 * deployment reads and writes the wrong half of a shared database. The role's
 * server-side search_path does not help: it governs raw SQL only.
 */

const original = process.env.DB_SCHEMA;

afterEach(() => {
  if (original === undefined) delete process.env.DB_SCHEMA;
  else process.env.DB_SCHEMA = original;
});

describe('resolveSchema', () => {
  it('reads the schema from the connection string', () => {
    delete process.env.DB_SCHEMA;
    expect(resolveSchema('postgresql://u:p@h:6543/postgres?schema=kraal')).toBe('kraal');
  });

  it('finds it wherever it sits among the other parameters', () => {
    delete process.env.DB_SCHEMA;
    expect(
      resolveSchema('postgresql://u:p@h:6543/postgres?pgbouncer=true&schema=kraal&connection_limit=1'),
    ).toBe('kraal');
  });

  it('lets DB_SCHEMA override the connection string', () => {
    process.env.DB_SCHEMA = 'kraal';
    // The runtime URL carries pooler parameters and no schema of its own; the
    // deploy passes the schema separately, and that must win.
    expect(resolveSchema('postgresql://u:p@h:6543/postgres?pgbouncer=true')).toBe('kraal');
  });

  it('returns undefined when nothing names a schema, leaving Prisma on public', () => {
    delete process.env.DB_SCHEMA;
    expect(resolveSchema('postgresql://u:p@h:5432/kraal_dev')).toBeUndefined();
  });

  it('ignores an empty DB_SCHEMA rather than addressing a schema named ""', () => {
    process.env.DB_SCHEMA = '   ';
    expect(resolveSchema('postgresql://u:p@h:6543/postgres?schema=kraal')).toBe('kraal');
  });

  it('decodes a percent-encoded schema name', () => {
    delete process.env.DB_SCHEMA;
    expect(resolveSchema('postgresql://u:p@h:6543/postgres?schema=my%20schema')).toBe('my schema');
  });
});

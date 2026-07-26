import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client.
 *
 * Uses the driver adapter rather than Prisma's default Rust query engine,
 * because the deployment target is Cloudflare Workers and the engine binary
 * cannot run there. The adapter routes queries through `pg`, which works under
 * `nodejs_compat`.
 *
 * Connection strings, and why there are two:
 *
 *   DATABASE_URL — Supabase's transaction-mode pooler, port 6543. Serverless
 *     invocations are numerous and short-lived; each one opening a direct
 *     Postgres connection exhausts the server's connection limit quickly. The
 *     pooler multiplexes them.
 *
 *   DIRECT_URL — a direct connection, port 5432. Migrations need it: the
 *     transaction pooler does not support prepared statements, advisory locks,
 *     or the session state that DDL relies on. Only ever used by the CLI, never
 *     at runtime.
 *
 * Getting these the wrong way round produces a system that works in development
 * and fails under load, which is the worst time to find out.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const adapter = new PrismaPg({
    connectionString,
    // The pooler holds the real pool; a large client-side pool on top of it
    // just queues in a second place. One connection per isolate is right.
    max: Number(process.env.DATABASE_POOL_MAX ?? 1),
    // Fail fast rather than hanging a request that a user is waiting on.
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

// Reusing the client across hot reloads in development; without this, each
// reload opens a new pool until Postgres refuses connections.
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * The transactional client type.
 *
 * Service functions take this rather than the root client so a caller can
 * compose several of them into one atomic unit. Money and the state change that
 * caused it must commit together or not at all (MASTER_PROMPT §10.1); a
 * function that quietly opens its own transaction makes that impossible.
 */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

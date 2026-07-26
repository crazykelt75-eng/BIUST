import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Next.js dev-mode hot reload re-executes modules, which otherwise opens a new
 * connection pool per reload until Postgres refuses them.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * The transactional client type.
 *
 * Service functions take this rather than the root client so that a caller can
 * compose several of them into one atomic unit. Money and the state change that
 * caused it must commit together or not at all (MASTER_PROMPT §10.1); a
 * function that quietly opens its own transaction makes that impossible.
 */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

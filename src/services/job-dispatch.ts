/**
 * Job dispatch.
 *
 * Resolves the queue at call time rather than at module load, because on
 * Workers the queue binding lives on the request environment and is not
 * available when modules are first evaluated.
 */

import { prisma } from '../db/client';
import { fanOutListing } from './match-worker';
import { CloudflareQueue, InlineQueue, type JobPayload, type JobQueue } from './queue';

function resolveQueue(): JobQueue {
  const binding = (globalThis as { QUEUE?: { send(body: unknown, o?: unknown): Promise<void> } }).QUEUE;
  if (binding) return new CloudflareQueue(binding);

  // Development and tests: run it here. Awaited, not fire-and-forget, so a
  // test never races the work it is asserting on.
  return new InlineQueue(runInline);
}

async function runInline(job: JobPayload): Promise<void> {
  if (job.kind === 'FAN_OUT_LISTING') {
    await fanOutListing(prisma, job.listingId);
    return;
  }
  throw new Error(`No inline handler for ${job.kind}`);
}

export async function enqueueFanOut(listingId: string): Promise<void> {
  try {
    await resolveQueue().enqueue({ kind: 'FAN_OUT_LISTING', listingId });
  } catch (error) {
    // A fan-out failure must not fail the publish. The listing is durable and
    // the farmer's work is safe; the alerts can be replayed by hand.
    console.error(`Could not enqueue fan-out for ${listingId}`, error);
  }
}

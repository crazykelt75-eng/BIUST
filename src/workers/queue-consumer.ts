/**
 * Cloudflare Queues consumer.
 *
 * Deployed as a separate Worker bound to the same queue the app produces to.
 *
 * Every handler here must be idempotent. Cloudflare retries a message whose
 * handler throws, and it delivers at-least-once — so a job that is not safe to
 * run twice will eventually run twice and corrupt something. `fanOutListing`
 * upserts its AlertSend rows on a unique key for exactly this reason.
 */

import { prisma } from '../db/client';
import type { JobPayload } from '../services/queue';
import { fanOutListing } from '../services/match-worker';

export interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatch<T> {
  messages: QueueMessage<T>[];
}

export default {
  async queue(batch: QueueBatch<JobPayload>): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handle(message.body);
        message.ack();
      } catch (error) {
        // Log and hand back for retry rather than acking. An acked failure is
        // silently lost work, and for a fan-out that means a listing nobody
        // ever hears about.
        console.error(`Job ${message.body.kind} failed`, error);
        message.retry({ delaySeconds: 30 });
      }
    }
  },
};

async function handle(job: JobPayload): Promise<void> {
  switch (job.kind) {
    case 'FAN_OUT_LISTING': {
      const result = await fanOutListing(prisma, job.listingId);
      console.info(
        `Fan-out ${job.listingId}: ${result.matched} matched, ` +
          `${result.queued} queued, ${result.suppressed} suppressed`,
      );
      return;
    }

    case 'SEND_SMS':
      // TODO: move OTP sends onto the queue too. Not yet — an OTP that arrives
      // via a queue retry 30 seconds later is worse than one that fails fast
      // and lets the user press the button again.
      throw new Error('SEND_SMS is not handled by the queue yet');

    case 'TRANSACTION_TIMEOUT':
      // TODO: the §7.2 state timeouts. Cloudflare Queues supports delayed
      // delivery up to 12 hours; longer deadlines (the 14-day permit window)
      // need a Cron Trigger sweeping stateDeadline instead.
      throw new Error('TRANSACTION_TIMEOUT is not handled by the queue yet');
  }
}

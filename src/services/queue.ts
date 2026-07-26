/**
 * Background work.
 *
 * MASTER_PROMPT.md §10.2 named BullMQ. That was wrong for this deployment:
 * BullMQ needs a persistent Redis connection, and Cloudflare Workers cannot
 * hold one. **Cloudflare Queues** is the replacement.
 *
 * The abstraction exists so the domain services never learn which one they are
 * on. `fanOutListing` already takes an injectable client and is idempotent, so
 * moving it behind a queue is plumbing, not a rewrite.
 *
 * Why this matters at all: a farmer publishing at a kraal on 2G must not wait
 * for a match sweep across every alert profile. The publish response should
 * return as soon as the listing is durable.
 */

export type JobPayload =
  | { kind: 'FAN_OUT_LISTING'; listingId: string }
  | { kind: 'SEND_SMS'; deliveryId: string; to: string; message: string }
  | { kind: 'TRANSACTION_TIMEOUT'; transactionId: string; expectedState: string };

export interface JobQueue {
  enqueue(job: JobPayload, options?: { delaySeconds?: number }): Promise<void>;
}

/**
 * Cloudflare Queues, via the binding injected into the Worker environment.
 *
 * Retries and dead-lettering are configured on the queue itself in
 * `wrangler.jsonc`, not here — a consumer that throws is retried by the
 * platform, which is why every consumer must be idempotent.
 */
export class CloudflareQueue implements JobQueue {
  constructor(private readonly binding: CloudflareQueueBinding) {}

  async enqueue(job: JobPayload, options?: { delaySeconds?: number }): Promise<void> {
    await this.binding.send(job, options?.delaySeconds ? { delaySeconds: options.delaySeconds } : undefined);
  }
}

export interface CloudflareQueueBinding {
  send(body: unknown, options?: { delaySeconds?: number }): Promise<void>;
}

/**
 * Runs the job immediately, in-process.
 *
 * Used in development and tests, and as the fallback when no queue binding is
 * present. Deliberately awaits rather than firing and forgetting: in a test, an
 * unawaited job is a race, and a race in a test suite is worse than a slow one.
 */
export class InlineQueue implements JobQueue {
  constructor(private readonly run: (job: JobPayload) => Promise<void>) {}

  async enqueue(job: JobPayload): Promise<void> {
    await this.run(job);
  }
}

/**
 * Never silently drops work.
 *
 * A queue that swallows jobs produces a system where listings are published and
 * nobody is ever told — which looks exactly like "no buyers are interested",
 * and is the hardest class of bug to notice.
 */
export class NoopQueue implements JobQueue {
  async enqueue(job: JobPayload): Promise<void> {
    throw new Error(
      `No job queue is configured; refusing to drop ${job.kind}. ` +
        'Bind QUEUE in wrangler.jsonc, or use InlineQueue in development.',
    );
  }
}

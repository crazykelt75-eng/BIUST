/**
 * Africa's Talking SMS gateway.
 *
 * Chosen over Twilio for Botswana coverage and because it also provides USSD,
 * which Phase 3 needs for feature phones (§9.4).
 *
 * Two things shape the error handling here, and both cost money when got wrong:
 *
 *   - **Retrying a permanent failure is pure waste.** An invalid number or an
 *     empty account balance will fail identically on every attempt. Those are
 *     classified as REJECTED and not retried.
 *
 *   - **Not retrying a transient failure loses a signup.** A farmer whose code
 *     never arrives does not file a bug report; they close the app. Timeouts
 *     and 5xx get a bounded retry with backoff.
 *
 * The message body is never logged or stored. It contains the one-time code.
 */

import type { SmsSender } from '../auth-service';
import { maskPhone } from '../../domain/auth/otp';

export type SmsFailureKind = 'TRANSIENT' | 'PERMANENT';

export class SmsError extends Error {
  constructor(
    message: string,
    readonly kind: SmsFailureKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SmsError';
  }
}

export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
  /** Registered alphanumeric sender ID, e.g. "KRAAL". Falls back to shared pool. */
  senderId?: string;
  /** Sandbox for development; live for production. */
  sandbox?: boolean;
  /** Bounded so a hung gateway cannot hold a request open. */
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface SendOutcome {
  providerRef?: string;
  cost?: string;
  attempts: number;
}

/**
 * Status codes from the Africa's Talking recipient response.
 *
 * 100 Processed · 101 Sent · 102 Queued are all accepted — the message has been
 * handed off. Everything else is a failure, split by whether trying again could
 * possibly help.
 */
const ACCEPTED = new Set([100, 101, 102]);

const PERMANENT_CODES: Record<number, string> = {
  401: 'RiskHold',
  402: 'InvalidSenderId',
  403: 'InvalidPhoneNumber',
  404: 'UnsupportedNumberType',
  405: 'InsufficientBalance',
  406: 'UserInBlacklist',
  407: 'CouldNotRoute',
};

export class AfricasTalkingSender implements SmsSender {
  private readonly baseUrl: string;

  constructor(private readonly config: AfricasTalkingConfig) {
    this.baseUrl = config.sandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
  }

  async send(args: { to: string; message: string }): Promise<void> {
    await this.sendWithOutcome(args);
  }

  async sendWithOutcome(args: { to: string; message: string }): Promise<SendOutcome> {
    const maxAttempts = this.config.maxAttempts ?? 3;
    let lastError: SmsError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const outcome = await this.attempt(args);
        return { ...outcome, attempts: attempt };
      } catch (error) {
        const smsError =
          error instanceof SmsError
            ? error
            : new SmsError(String(error), 'TRANSIENT');

        // Retrying a permanent failure burns money and time for a result that
        // cannot change.
        if (smsError.kind === 'PERMANENT') throw smsError;

        lastError = smsError;
        if (attempt < maxAttempts) {
          await delay(2 ** (attempt - 1) * 500);
        }
      }
    }

    throw lastError ?? new SmsError('SMS send failed', 'TRANSIENT');
  }

  private async attempt(args: { to: string; message: string }): Promise<Omit<SendOutcome, 'attempts'>> {
    const body = new URLSearchParams({
      username: this.config.username,
      to: args.to,
      message: args.message,
    });
    if (this.config.senderId) body.set('from', this.config.senderId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          apiKey: this.config.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new SmsError(
        aborted ? 'SMS gateway timed out' : 'Could not reach the SMS gateway',
        'TRANSIENT',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      // Bad credentials will not fix themselves on retry.
      throw new SmsError('SMS gateway rejected our credentials', 'PERMANENT', String(response.status));
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SmsError(`SMS gateway returned ${response.status}`, 'TRANSIENT', String(response.status));
    }
    if (!response.ok) {
      throw new SmsError(`SMS gateway returned ${response.status}`, 'PERMANENT', String(response.status));
    }

    const payload = (await response.json().catch(() => null)) as AtResponse | null;
    const recipient = payload?.SMSMessageData?.Recipients?.[0];

    if (!recipient) {
      // No recipient entry usually means the request was malformed or the
      // account is not provisioned — either way, not a retry.
      throw new SmsError(
        payload?.SMSMessageData?.Message ?? 'SMS gateway returned no recipient',
        'PERMANENT',
      );
    }

    if (ACCEPTED.has(recipient.statusCode)) {
      return { providerRef: recipient.messageId, cost: recipient.cost };
    }

    const permanent = PERMANENT_CODES[recipient.statusCode];
    throw new SmsError(
      `SMS rejected: ${recipient.status ?? permanent ?? 'unknown'}`,
      permanent ? 'PERMANENT' : 'TRANSIENT',
      String(recipient.statusCode),
    );
  }
}

interface AtResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: {
      statusCode: number;
      number: string;
      status?: string;
      cost?: string;
      messageId?: string;
    }[];
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Development sender. Writes the masked number and the code to the server log.
 *
 * Acceptable locally, never in production: anyone with log access could sign in
 * as anyone. `resolveSender` refuses to select it there.
 */
export const consoleSender: SmsSender = {
  async send({ to, message }) {
    console.info(`[sms:dev] ${maskPhone(to)}: ${message}`);
  },
};

/**
 * Pick a sender from the environment.
 *
 * Refuses to fall back to the console logger in production. A deployment that
 * quietly logs one-time codes instead of sending them is worse than one that
 * fails loudly — the failure is invisible until an account is taken over.
 */
export function resolveSender(): SmsSender {
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;

  if (apiKey && username) {
    return new AfricasTalkingSender({
      apiKey,
      username,
      senderId: process.env.AT_SENDER_ID,
      sandbox: process.env.AT_SANDBOX === 'true',
    });
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No SMS gateway configured. Set AT_API_KEY and AT_USERNAME. ' +
        'Refusing to fall back to logging one-time codes in production.',
    );
  }

  return consoleSender;
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AfricasTalkingSender, SmsError, resolveSender } from './africas-talking';

function atResponse(statusCode: number, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      SMSMessageData: {
        Message: 'Sent to 1/1',
        Recipients: [{ statusCode, number: '+26771234567', ...extra }],
      },
    }),
  } as Response;
}

function httpResponse(status: number) {
  return { ok: status < 400, status, json: async () => ({}) } as Response;
}

const config = { apiKey: 'k', username: 'u', maxAttempts: 3, timeoutMs: 50 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('successful sends', () => {
  it('accepts the codes that mean the message was handed off', async () => {
    for (const code of [100, 101, 102]) {
      const fetchMock = vi.fn().mockResolvedValue(atResponse(code, { messageId: 'm1', cost: 'BWP 0.8' }));
      vi.stubGlobal('fetch', fetchMock);

      const sender = new AfricasTalkingSender(config);
      const outcome = await sender.sendWithOutcome({ to: '+26771234567', message: 'x' });

      expect(outcome.providerRef).toBe('m1');
      expect(outcome.cost).toBe('BWP 0.8');
      expect(outcome.attempts).toBe(1);
    }
  });

  it('sends form-encoded, as the gateway requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(atResponse(101));
    vi.stubGlobal('fetch', fetchMock);

    await new AfricasTalkingSender({ ...config, senderId: 'KRAAL' }).send({
      to: '+26771234567',
      message: 'hello',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.headers.apiKey).toBe('k');
    expect(String(init.body)).toContain('from=KRAAL');
  });

  it('uses the sandbox endpoint when asked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(atResponse(101));
    vi.stubGlobal('fetch', fetchMock);

    await new AfricasTalkingSender({ ...config, sandbox: true }).send({ to: '+267', message: 'x' });
    expect(fetchMock.mock.calls[0]![0]).toContain('sandbox');
  });
});

describe('permanent failures are not retried', () => {
  // Retrying these burns money and time for a result that cannot change.
  const permanent: [number, string][] = [
    [403, 'invalid phone number'],
    [405, 'insufficient balance'],
    [406, 'blacklisted'],
    [402, 'invalid sender id'],
  ];

  for (const [code, label] of permanent) {
    it(`does not retry ${label}`, async () => {
      const fetchMock = vi.fn().mockResolvedValue(atResponse(code, { status: label }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        new AfricasTalkingSender(config).send({ to: '+267', message: 'x' }),
      ).rejects.toThrow(SmsError);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it('does not retry bad credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new AfricasTalkingSender(config).send({ to: '+267', message: 'x' }),
    ).rejects.toThrow(/credentials/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies insufficient balance as permanent, so it surfaces loudly', async () => {
    // An empty account fails every send silently if treated as transient.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(atResponse(405, { status: 'InsufficientBalance' })));

    try {
      await new AfricasTalkingSender(config).sendWithOutcome({ to: '+267', message: 'x' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as SmsError).kind).toBe('PERMANENT');
      expect((error as SmsError).code).toBe('405');
    }
  });
});

describe('transient failures are retried', () => {
  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(httpResponse(503))
      .mockResolvedValueOnce(atResponse(101, { messageId: 'm2' }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await new AfricasTalkingSender(config).sendWithOutcome({
      to: '+267',
      message: 'x',
    });

    expect(outcome.attempts).toBe(2);
    expect(outcome.providerRef).toBe('m2');
  });

  it('retries rate limiting', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(httpResponse(429))
      .mockResolvedValueOnce(atResponse(101));
    vi.stubGlobal('fetch', fetchMock);

    await new AfricasTalkingSender(config).send({ to: '+267', message: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(atResponse(101));
    vi.stubGlobal('fetch', fetchMock);

    await new AfricasTalkingSender(config).send({ to: '+267', message: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt cap rather than retrying forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new AfricasTalkingSender(config).send({ to: '+267', message: 'x' }),
    ).rejects.toThrow(SmsError);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('sender selection', () => {
  // NODE_ENV is typed readonly; vi.stubEnv is the supported way to change it.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to log codes instead of sending them in production', () => {
    // A deployment that quietly logs one-time codes is worse than one that
    // fails loudly — the failure is invisible until an account is taken over.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AT_API_KEY', '');
    vi.stubEnv('AT_USERNAME', '');

    expect(() => resolveSender()).toThrow(/Refusing to fall back/);
  });

  it('uses the console sender in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AT_API_KEY', '');
    expect(resolveSender()).toBeDefined();
  });

  it('uses the gateway when configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AT_API_KEY', 'k');
    vi.stubEnv('AT_USERNAME', 'u');
    expect(resolveSender()).toBeInstanceOf(AfricasTalkingSender);
  });
});

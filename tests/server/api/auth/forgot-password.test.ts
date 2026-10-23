import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Mock at the SDK boundary — let user service run for real
// ---------------------------------------------------------------------------
const mockPasswordRequestReset = vi.fn().mockResolvedValue({ succeeded: true });

const mockSDK = {
  crm: {
    user: {
      password: {
        requestReset: mockPasswordRequestReset,
      },
    },
  },
};

vi.mock('../../../../server/services/_sdk', () => ({
  getTenantSDK: vi.fn().mockResolvedValue(mockSDK),
}));

// Rate limiter — uses useStorage('kv'), must stay mocked
const mockCheck = vi
  .fn()
  .mockResolvedValue({ allowed: true, remaining: 4, resetTime: 0 });
vi.mock('../../../../server/utils/rate-limiter', () => ({
  forgotPasswordRateLimiter: {
    check: (...args: unknown[]) => mockCheck(...args),
  },
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('../../../../server/utils/logger', () => ({ logger: mockLogger }));

vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('readValidatedBody', vi.fn());
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  RATE_LIMITED: 'RATE_LIMITED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
});
vi.stubGlobal('wrapServiceCall', async (fn: () => Promise<unknown>) => fn());

describe('POST /api/auth/forgot-password', () => {
  const mockEvent = {} as unknown as import('h3').H3Event;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheck.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetTime: 0,
    });
    vi.mocked(readValidatedBody).mockResolvedValue({
      email: 'user@example.com',
    });
  });

  it('returns success: true regardless of email existence', async () => {
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    const result = await handler(mockEvent);
    expect(result).toEqual({ success: true });
  });

  it('calls SDK password.requestReset with the email', async () => {
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    await handler(mockEvent);
    expect(mockPasswordRequestReset).toHaveBeenCalledWith('user@example.com');
  });

  it('still returns success: true when SDK throws (email not found)', async () => {
    mockPasswordRequestReset.mockRejectedValueOnce(new Error('User not found'));
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    const result = await handler(mockEvent);
    expect(result).toEqual({ success: true });
  });

  it('throws RATE_LIMITED when rate limit exceeded', async () => {
    mockCheck.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetTime: 0,
    });
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    await expect(handler(mockEvent)).rejects.toThrow('RATE_LIMITED');
  });

  it('logs a failed Geins call as a category, never the upstream text', async () => {
    mockPasswordRequestReset.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Variable email "user@example.com" rejected at https://api.example/x?token=s3cret, Bearer abc.def',
        ),
        {
          networkError: {
            statusCode: 401,
            result: { echo: 'user@example.com' },
          },
          data: { originalMessage: 'user@example.com' },
        },
      ),
    );
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    const result = await handler(mockEvent);
    expect(result).toEqual({ success: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Password reset request failed',
      {
        tenantId: undefined,
        category: 'network',
        errorName: 'Error',
        httpStatus: 401,
      },
    );
    const logged = JSON.stringify(mockLogger.warn.mock.calls);
    for (const secret of [
      'user@example.com',
      's3cret',
      'Bearer',
      'https://',
      '127.0.0.1',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('logs when Geins accepts the request', async () => {
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    await handler(mockEvent);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Password reset request accepted by Geins',
      expect.any(Object),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('logs a rate-limited request', async () => {
    mockCheck.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetTime: 0,
    });
    const handler = (
      await import('../../../../server/api/auth/forgot-password.post')
    ).default;
    await expect(handler(mockEvent)).rejects.toThrow('RATE_LIMITED');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Password reset request rate limited',
      expect.any(Object),
    );
  });
});

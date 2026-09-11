import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

const mockCheck = vi
  .fn()
  .mockResolvedValue({ allowed: true, remaining: 4, resetTime: 0 });
vi.mock('../../../server/utils/rate-limiter', () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    check: (...args: unknown[]) => mockCheck(...args),
  })),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

const mockGetHeader = vi.fn();
vi.mock('h3', () => ({
  getHeader: (...args: unknown[]) => mockGetHeader(...args),
}));

const mockReadAdminAuthConfig = vi
  .fn()
  .mockReturnValue({ adminSecret: 'correct-secret' });
vi.mock('../../../server/utils/admin-config', () => ({
  readAdminAuthConfig: (...args: unknown[]) => mockReadAdminAuthConfig(...args),
}));

vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
});

const { timingSafeStringEqual, requireAdminAuth } =
  await import('../../../server/utils/admin-auth');

describe('timingSafeStringEqual', () => {
  it('accepts a value matching the secret', () => {
    expect(timingSafeStringEqual('correct-secret', 'correct-secret')).toBe(
      true,
    );
  });

  it('rejects a value that does not match', () => {
    expect(timingSafeStringEqual('wrong-secret', 'correct-secret')).toBe(false);
  });

  it('rejects a value that is a prefix or different length', () => {
    expect(timingSafeStringEqual('correct', 'correct-secret')).toBe(false);
    expect(
      timingSafeStringEqual('correct-secret-extra', 'correct-secret'),
    ).toBe(false);
  });

  it('treats two empty strings as equal', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });
});

describe('requireAdminAuth', () => {
  const mockEvent = {} as H3Event;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheck.mockResolvedValue({ allowed: true, remaining: 4, resetTime: 0 });
    mockReadAdminAuthConfig.mockReturnValue({ adminSecret: 'correct-secret' });
  });

  it('resolves when the header matches the configured secret', async () => {
    mockGetHeader.mockReturnValue('correct-secret');
    await expect(requireAdminAuth(mockEvent)).resolves.toBeUndefined();
  });

  it('rejects a missing header', async () => {
    mockGetHeader.mockReturnValue(undefined);
    await expect(requireAdminAuth(mockEvent)).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects a header that does not match', async () => {
    mockGetHeader.mockReturnValue('wrong-secret');
    await expect(requireAdminAuth(mockEvent)).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects when no secret is configured, even with a header provided', async () => {
    mockReadAdminAuthConfig.mockReturnValue({ adminSecret: '' });
    mockGetHeader.mockReturnValue('anything');
    await expect(requireAdminAuth(mockEvent)).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects once the rate limit is exceeded, before checking the key', async () => {
    mockCheck.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0 });
    mockGetHeader.mockReturnValue('correct-secret');
    await expect(requireAdminAuth(mockEvent)).rejects.toThrow('RATE_LIMITED');
  });
});

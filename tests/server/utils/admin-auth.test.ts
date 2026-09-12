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

  it('resolves with the caller when the header matches the configured secret', async () => {
    mockGetHeader.mockReturnValue('correct-secret');
    // Returns the caller rather than void, so an endpoint can act on the
    // scope it was given instead of only knowing the key was valid.
    await expect(requireAdminAuth(mockEvent)).resolves.toEqual({
      scope: 'write',
    });
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

describe('requireAdminAuth — read vs write scope', () => {
  const mockEvent = {} as H3Event;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheck.mockResolvedValue({ allowed: true, remaining: 4, resetTime: 0 });
    mockReadAdminAuthConfig.mockReturnValue({
      adminSecret: 'write-secret',
      adminReadSecret: 'read-secret',
    });
  });

  it('tells the caller which scope their key carries', async () => {
    mockGetHeader.mockReturnValue('write-secret');
    await expect(requireAdminAuth(mockEvent, 'write')).resolves.toEqual({
      scope: 'write',
    });

    mockGetHeader.mockReturnValue('read-secret');
    await expect(requireAdminAuth(mockEvent, 'read')).resolves.toEqual({
      scope: 'read',
    });
  });

  it('refuses a write when the caller only holds the read key', async () => {
    // The whole point of the separate key: a service that only needs to
    // read a tenant's config must not be able to rewrite every tenant.
    mockGetHeader.mockReturnValue('read-secret');
    await expect(requireAdminAuth(mockEvent, 'write')).rejects.toThrow(
      'UNAUTHORIZED',
    );
  });

  it('lets the write key read, since it is the stronger credential', async () => {
    mockGetHeader.mockReturnValue('write-secret');
    await expect(requireAdminAuth(mockEvent, 'read')).resolves.toEqual({
      scope: 'write',
    });
  });

  it('defaults to requiring write, so existing callers keep their guarantee', async () => {
    mockGetHeader.mockReturnValue('read-secret');
    await expect(requireAdminAuth(mockEvent)).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects the read key when no read secret is configured', async () => {
    mockReadAdminAuthConfig.mockReturnValue({
      adminSecret: 'write-secret',
      adminReadSecret: '',
    });
    mockGetHeader.mockReturnValue('read-secret');
    await expect(requireAdminAuth(mockEvent, 'read')).rejects.toThrow(
      'UNAUTHORIZED',
    );
  });

  it('still accepts the write key when no read secret is configured', async () => {
    mockReadAdminAuthConfig.mockReturnValue({
      adminSecret: 'write-secret',
      adminReadSecret: '',
    });
    mockGetHeader.mockReturnValue('write-secret');
    await expect(requireAdminAuth(mockEvent, 'read')).resolves.toEqual({
      scope: 'write',
    });
  });
});

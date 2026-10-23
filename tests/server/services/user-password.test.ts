import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

// Mock the SDK module
const mockRequestReset = vi.fn();
const mockCommitReset = vi.fn();

const mockSDK = {
  crm: {
    user: {
      password: {
        requestReset: mockRequestReset,
        commitReset: mockCommitReset,
      },
    },
  },
};

vi.mock('../../../server/services/_sdk', () => ({
  getTenantSDK: vi.fn().mockResolvedValue(mockSDK),
}));

// Mock auto-imported wrapServiceCall
vi.stubGlobal(
  'wrapServiceCall',
  vi.fn(async (fn: () => Promise<unknown>) => fn()),
);

// Mock ErrorCode and AuthError (auto-imports used in user.ts)
vi.stubGlobal('ErrorCode', {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
});

let user: typeof import('../../../server/services/user');

describe('requestPasswordReset', () => {
  const mockEvent = {} as H3Event;

  beforeEach(async () => {
    vi.clearAllMocks();
    user = await import('../../../server/services/user');
  });

  it('calls SDK requestReset with email', async () => {
    mockRequestReset.mockResolvedValueOnce({ succeeded: true });
    await user.requestPasswordReset('user@example.com', mockEvent);
    expect(mockRequestReset).toHaveBeenCalledWith('user@example.com');
  });

  it('returns the SDK result', async () => {
    mockRequestReset.mockResolvedValueOnce({ succeeded: true });
    const result = await user.requestPasswordReset(
      'user@example.com',
      mockEvent,
    );
    expect(result).toEqual({ succeeded: true });
  });

  it('passes SDK failures through raw, not via wrapServiceCall', async () => {
    // wrapServiceCall would log the upstream text through createAppError;
    // the forgot-password handler logs a safe summary instead.
    const upstream = new Error('upstream text');
    mockRequestReset.mockRejectedValueOnce(upstream);
    await expect(
      user.requestPasswordReset('user@example.com', mockEvent),
    ).rejects.toBe(upstream);
    expect(wrapServiceCall).not.toHaveBeenCalled();
  });
});

describe('commitPasswordReset', () => {
  const mockEvent = {} as H3Event;

  beforeEach(async () => {
    vi.clearAllMocks();
    user = await import('../../../server/services/user');
  });

  it('calls SDK commitReset with resetKey and password', async () => {
    mockCommitReset.mockResolvedValueOnce({ succeeded: true });
    await user.commitPasswordReset('key123', 'newpassword', mockEvent);
    expect(mockCommitReset).toHaveBeenCalledWith('key123', 'newpassword');
  });

  it('returns the SDK result', async () => {
    mockCommitReset.mockResolvedValueOnce({ succeeded: true });
    const result = await user.commitPasswordReset(
      'key123',
      'newpassword',
      mockEvent,
    );
    expect(result).toEqual({ succeeded: true });
  });
});

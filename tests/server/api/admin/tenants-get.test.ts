import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = (...args: unknown[]) => unknown;

const mockRequireAdminAuth = vi.fn().mockResolvedValue({ scope: 'read' });
vi.mock('../../../../server/utils/admin-auth', () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
}));

const mockResolveTenant = vi.fn();
vi.mock('../../../../server/utils/tenant', () => ({
  resolveTenant: (...args: unknown[]) => mockResolveTenant(...args),
}));

const mockGetRouterParam = vi.fn();
vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('getRouterParam', (...args: unknown[]) =>
  mockGetRouterParam(...args),
);
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
});

const handler = (
  await import('../../../../server/api/admin/tenants/[hostname].get')
).default as unknown as AnyFn;

const TENANT = {
  tenantId: 'odelco',
  hostname: 'odelco.se',
  geinsSettings: { apiKey: 'secret-key', accountName: 'odelco' },
  productMediaParameters: { videourl: 'video' },
  isActive: true,
};

describe('GET /api/admin/tenants/:hostname', () => {
  const mockEvent = {} as import('h3').H3Event;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminAuth.mockResolvedValue({ scope: 'read' });
    mockGetRouterParam.mockReturnValue('odelco.se');
    mockResolveTenant.mockResolvedValue(TENANT);
  });

  it('only requires the read scope, so a read-only key opens it', async () => {
    await handler(mockEvent);
    expect(mockRequireAdminAuth).toHaveBeenCalledWith(mockEvent, 'read');
  });

  it('returns the resolved tenant config', async () => {
    await expect(handler(mockEvent)).resolves.toEqual(TENANT);
  });

  it('returns the Geins settings the consumer needs to write with', async () => {
    // The caller's whole reason for asking is resolving a tenant's real
    // Geins credentials and media mapping, so these must not be stripped.
    const result = (await handler(mockEvent)) as typeof TENANT;
    expect(result.geinsSettings.apiKey).toBe('secret-key');
    expect(result.productMediaParameters).toEqual({ videourl: 'video' });
  });

  it('looks the tenant up by the hostname in the path', async () => {
    mockGetRouterParam.mockReturnValue('staging-odelco.hdng.ai');
    await handler(mockEvent);
    expect(mockResolveTenant).toHaveBeenCalledWith('staging-odelco.hdng.ai');
  });

  it('404s for a hostname no tenant claims', async () => {
    mockResolveTenant.mockResolvedValue(null);
    await expect(handler(mockEvent)).rejects.toThrow('NOT_FOUND');
  });

  it('rejects a missing hostname rather than resolving an empty one', async () => {
    mockGetRouterParam.mockReturnValue(undefined);
    await expect(handler(mockEvent)).rejects.toThrow('VALIDATION_ERROR');
    expect(mockResolveTenant).not.toHaveBeenCalled();
  });

  it('authorizes before doing any lookup', async () => {
    mockRequireAdminAuth.mockRejectedValue(new Error('UNAUTHORIZED: nope'));
    await expect(handler(mockEvent)).rejects.toThrow('UNAUTHORIZED');
    expect(mockResolveTenant).not.toHaveBeenCalled();
  });
});

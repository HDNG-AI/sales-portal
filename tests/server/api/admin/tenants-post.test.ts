import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = (...args: unknown[]) => unknown;

const mockRequireAdminAuth = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../server/utils/admin-auth', () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
}));

const mockResolveTenant = vi.fn();
vi.mock('../../../../server/utils/tenant', () => ({
  resolveTenant: (...args: unknown[]) => mockResolveTenant(...args),
  DEFAULT_GEINS_SETTINGS: {
    apiKey: 'dev',
    accountName: 'dev',
    channel: '1',
    tld: 'se',
    locale: 'sv-SE',
    market: 'se',
    environment: 'production',
    availableLocales: ['sv-SE'],
    availableMarkets: ['se'],
  },
}));

const mockCreateTenant = vi.fn();
vi.mock('../../../../server/utils/tenant-crud', () => ({
  createTenant: (...args: unknown[]) => mockCreateTenant(...args),
}));

vi.mock('../../../../server/schemas/admin-input', () => ({
  CreateTenantSchema: { parse: vi.fn() },
}));

vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('readValidatedBody', vi.fn());
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  UNAUTHORIZED: 'UNAUTHORIZED',
  CONFLICT: 'CONFLICT',
});

function mockBody(overrides: Record<string, unknown> = {}) {
  (globalThis.readValidatedBody as ReturnType<typeof vi.fn>).mockResolvedValue({
    hostname: 'shop.example.com',
    ...overrides,
  });
}

describe('POST /api/admin/tenants', () => {
  const mockEvent = {} as import('h3').H3Event;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminAuth.mockResolvedValue(undefined);
    mockResolveTenant.mockResolvedValue(null);
    mockCreateTenant.mockResolvedValue({
      tenantId: 'shop',
      hostname: 'shop.example.com',
      themeHash: 'abc123',
    });
  });

  it('always runs the admin auth gate first', async () => {
    mockBody();
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);
    expect(mockRequireAdminAuth).toHaveBeenCalledWith(mockEvent);
  });

  it('creates a new tenant when the hostname does not already resolve', async () => {
    mockBody();
    mockResolveTenant.mockResolvedValue(null);
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    const result = await handler(mockEvent);
    expect(mockCreateTenant).toHaveBeenCalled();
    expect(result).toEqual({
      tenantId: 'shop',
      hostname: 'shop.example.com',
      themeHash: 'abc123',
    });
  });

  it('rejects when the hostname already resolves to a tenant and allowUpdate is not set', async () => {
    mockBody();
    mockResolveTenant.mockResolvedValue({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await expect(handler(mockEvent)).rejects.toThrow('CONFLICT');
    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it('proceeds when the hostname already resolves and allowUpdate is true', async () => {
    mockBody({ allowUpdate: true });
    mockResolveTenant.mockResolvedValue({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);
    expect(mockCreateTenant).toHaveBeenCalled();
  });

  it('rejects when an explicit tenantId does not match the tenant the hostname already resolves to, even with allowUpdate', async () => {
    mockBody({ tenantId: 'wrong-id', allowUpdate: true });
    mockResolveTenant.mockResolvedValue({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await expect(handler(mockEvent)).rejects.toThrow('CONFLICT');
    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it('allows a matching explicit tenantId against an existing hostname when allowUpdate is true', async () => {
    mockBody({ tenantId: 'existing-shop', allowUpdate: true });
    mockResolveTenant.mockResolvedValue({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);
    expect(mockCreateTenant).toHaveBeenCalled();
  });
});

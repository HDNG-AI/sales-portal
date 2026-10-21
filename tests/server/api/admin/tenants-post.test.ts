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
vi.mock('../../../../server/utils/tenant-crud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenant: (...args: unknown[]) => mockCreateTenant(...args),
}));

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../../../server/utils/logger', () => ({ logger: mockLogger }));
vi.mock('../../../../server/utils/rate-limiter', () => ({
  getClientIp: () => '203.0.113.7',
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
  (
    (globalThis as Record<string, unknown>).readValidatedBody as ReturnType<
      typeof vi.fn
    >
  ).mockResolvedValue({
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

  it('falls back to the placeholder DEFAULT_GEINS_SETTINGS for a brand-new tenant with no geinsSettings provided', async () => {
    mockBody();
    mockResolveTenant.mockResolvedValue(null);
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);
    const [{ config }] = mockCreateTenant.mock.calls[0] as [
      { config: { geinsSettings?: unknown } },
    ];
    expect(config.geinsSettings).toEqual(
      expect.objectContaining({ apiKey: 'dev', accountName: 'dev' }),
    );
  });

  it('preserves an existing tenant real geinsSettings when updating without providing new ones (regression: omitting geinsSettings must never blank out real credentials)', async () => {
    // Reproduces the bug found live on 2026-09-05: updating boattools'
    // cms.menus without resending geinsSettings silently reset its real
    // Geins API key back to the DEFAULT_GEINS_SETTINGS placeholder,
    // breaking every live product/CMS call for that tenant.
    mockBody({ allowUpdate: true, cms: { slots: {} } });
    mockResolveTenant.mockResolvedValue({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
      geinsSettings: { apiKey: 'real-boattools-key', accountName: 'boattools' },
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);
    const [{ config }] = mockCreateTenant.mock.calls[0] as [
      { config: { geinsSettings?: unknown } },
    ];
    expect(config.geinsSettings).toBeUndefined();
  });

  it('still applies newly-provided geinsSettings on an update when they are explicitly sent', async () => {
    mockBody({
      allowUpdate: true,
      geinsSettings: {
        apiKey: 'rotated-key',
        accountName: 'boattools',
        channel: '1',
        tld: 'se',
        locale: 'sv-SE',
        market: 'se',
        environment: 'production',
      },
    });
    mockResolveTenant.mockResolvedValue({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
      geinsSettings: { apiKey: 'old-key', accountName: 'boattools' },
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);
    const [{ config }] = mockCreateTenant.mock.calls[0] as [
      { config: { geinsSettings?: { apiKey?: string } } },
    ];
    expect(config.geinsSettings?.apiKey).toBe('rotated-key');
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

  it('writes an audit entry naming the critical fields an update changed, without their values', async () => {
    mockRequireAdminAuth.mockResolvedValue({ scope: 'write' });
    mockBody({ allowUpdate: true, checkoutMode: 'hosted' });
    const previous = {
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
      checkoutMode: 'custom',
      geinsSettings: { apiKey: 'old-key', accountName: 'boattools' },
    };
    mockResolveTenant.mockResolvedValue(previous);
    mockCreateTenant.mockResolvedValue({
      ...previous,
      checkoutMode: 'hosted',
      geinsSettings: { apiKey: 'attacker-key', accountName: 'attacker' },
      themeHash: 'abc123',
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const [message, context] = mockLogger.warn.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toContain('[admin-audit]');
    expect(context).toMatchObject({
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
      scope: 'write',
      clientIp: '203.0.113.7',
      created: false,
      criticalFields: [
        'checkoutMode',
        'geinsSettings.accountName',
        'geinsSettings.apiKey',
      ],
    });
    const logged = JSON.stringify(mockLogger.warn.mock.calls);
    expect(logged).not.toContain('attacker-key');
    expect(logged).not.toContain('old-key');
  });

  it('logs a non-critical update at info level', async () => {
    mockBody({ allowUpdate: true });
    const previous = {
      tenantId: 'existing-shop',
      hostname: 'shop.example.com',
      branding: { name: 'Old' },
    };
    mockResolveTenant.mockResolvedValue(previous);
    mockCreateTenant.mockResolvedValue({
      ...previous,
      branding: { name: 'New' },
    });
    const handler = (await import('../../../../server/api/admin/tenants.post'))
      .default;
    await handler(mockEvent);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('[admin-audit]'),
      expect.objectContaining({
        changedFields: ['branding'],
        criticalFields: [],
      }),
    );
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

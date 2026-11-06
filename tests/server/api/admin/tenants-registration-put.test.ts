import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = (...args: unknown[]) => unknown;

const mockRequireAdminAuth = vi.fn().mockResolvedValue({ scope: 'write' });
vi.mock('../../../../server/utils/admin-auth', () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
}));

const mockSetRegistration = vi.fn();
vi.mock('../../../../server/utils/tenant-crud', () => ({
  setTenantRegistrationEnabled: (...args: unknown[]) =>
    mockSetRegistration(...args),
}));

const mockGetRouterParam = vi.fn();
let body: unknown = { enabled: false };
vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('getRouterParam', (...args: unknown[]) =>
  mockGetRouterParam(...args),
);
vi.stubGlobal(
  'readValidatedBody',
  vi.fn(async (_event: unknown, parse: (d: unknown) => unknown) => parse(body)),
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
  await import('../../../../server/api/admin/tenants/[hostname]/registration.put')
).default as unknown as AnyFn;

describe('PUT /api/admin/tenants/:hostname/registration', () => {
  const event = {} as import('h3').H3Event;

  beforeEach(() => {
    vi.clearAllMocks();
    body = { enabled: false };
    mockRequireAdminAuth.mockResolvedValue({ scope: 'write' });
    mockGetRouterParam.mockReturnValue('Staging-Odelco.hdng.ai ');
    mockSetRegistration.mockResolvedValue({
      tenantId: 'odelco',
      registrationEnabled: false,
    });
  });

  it('requires the write scope and never writes when auth fails', async () => {
    mockRequireAdminAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(handler(event)).rejects.toThrow('UNAUTHORIZED');
    expect(mockRequireAdminAuth).toHaveBeenCalledWith(event, 'write');
    expect(mockSetRegistration).not.toHaveBeenCalled();
  });

  it('switches registration off for the normalised hostname only', async () => {
    await expect(handler(event)).resolves.toEqual({
      tenantId: 'odelco',
      registrationEnabled: false,
    });
    expect(mockSetRegistration).toHaveBeenCalledWith(
      'staging-odelco.hdng.ai',
      false,
      event,
    );
  });

  it('rejects any other field, so applyForAccount cannot be changed here', async () => {
    body = { enabled: false, applyForAccount: false };
    await expect(handler(event)).rejects.toThrow();
    expect(mockSetRegistration).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean flag', async () => {
    body = { enabled: 'false' };
    await expect(handler(event)).rejects.toThrow();
    expect(mockSetRegistration).not.toHaveBeenCalled();
  });

  it('404s for a hostname no tenant claims', async () => {
    mockSetRegistration.mockResolvedValue(null);
    await expect(handler(event)).rejects.toThrow('NOT_FOUND');
  });
});

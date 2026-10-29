import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';
import { UpdateTenantGuestHiddenBrandsSchema } from '../../../../server/schemas/admin-input';

type AnyFn = (...args: unknown[]) => unknown;

const mockAuth = vi.fn();
vi.mock('../../../../server/utils/admin-auth', () => ({
  requireCatalogAdminAuth: (...args: unknown[]) => mockAuth(...args),
}));

const mockGet = vi.fn();
const mockSet = vi.fn();
vi.mock('../../../../server/utils/tenant-crud', () => ({
  getTenantGuestHiddenBrands: (...args: unknown[]) => mockGet(...args),
  setTenantGuestHiddenBrands: (...args: unknown[]) => mockSet(...args),
}));

// Router param and body travel on the fake event itself.
interface FakeEvent {
  hostname?: string;
  body?: unknown;
  deny?: string;
}
vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('getRouterParam', (event: FakeEvent) => event.hostname);
vi.stubGlobal(
  'readValidatedBody',
  async (event: FakeEvent, validate: (body: unknown) => unknown) =>
    validate(event.body),
);
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
});

const getHandler = (
  await import('../../../../server/api/admin/tenants/[hostname]/guest-hidden-brands.get')
).default as unknown as (event: H3Event) => Promise<unknown>;
const putHandler = (
  await import('../../../../server/api/admin/tenants/[hostname]/guest-hidden-brands.put')
).default as unknown as (event: H3Event) => Promise<unknown>;

function req(hostname?: string, body?: unknown, deny?: string): H3Event {
  return { hostname, body, deny } as unknown as H3Event;
}

beforeEach(() => {
  // The gate's verdict rides on the event, not on a one-shot mock value, so
  // concurrently running tests cannot consume each other's answers.
  mockAuth.mockImplementation(async (event: FakeEvent) => {
    if (event.deny) throw new Error(event.deny);
    return { scope: 'write', catalog: true };
  });
  mockGet.mockImplementation(async (hostname: string) =>
    hostname === 'shop.example.com'
      ? { tenantId: 'shop', guestHiddenBrandIds: [7] }
      : null,
  );
  mockSet.mockImplementation(async (hostname: string, ids: number[]) =>
    hostname === 'shop.example.com'
      ? { tenantId: 'shop', guestHiddenBrandIds: ids }
      : null,
  );
});

describe('GET /api/admin/tenants/:hostname/guest-hidden-brands', () => {
  it('asks the catalog gate for read access to the named hostname', async () => {
    const event = req(' Shop.Example.com ');
    await getHandler(event);
    expect(mockAuth).toHaveBeenCalledWith(event, 'read', 'shop.example.com');
  });

  it('returns { tenantId, guestHiddenBrandIds }', async () => {
    await expect(getHandler(req('shop.example.com'))).resolves.toEqual({
      tenantId: 'shop',
      guestHiddenBrandIds: [7],
    });
  });

  it('404s for a hostname no tenant claims', async () => {
    await expect(getHandler(req('nobody.example.com'))).rejects.toThrow(
      'NOT_FOUND',
    );
  });

  it('authorizes before any lookup', async () => {
    await expect(
      getHandler(req('nope.example.com', undefined, 'UNAUTHORIZED: no')),
    ).rejects.toThrow('UNAUTHORIZED');
    expect(mockGet).not.toHaveBeenCalledWith(
      'nope.example.com',
      expect.anything(),
    );
  });
});

describe('PUT /api/admin/tenants/:hostname/guest-hidden-brands', () => {
  it('asks the catalog gate for write access to the named hostname', async () => {
    const event = req('shop.example.com', { brandIds: [7] });
    await putHandler(event);
    expect(mockAuth).toHaveBeenCalledWith(event, 'write', 'shop.example.com');
  });

  it('replaces the list and returns { tenantId, guestHiddenBrandIds }', async () => {
    await expect(
      putHandler(req('shop.example.com', { brandIds: [7, 9] })),
    ).resolves.toEqual({ tenantId: 'shop', guestHiddenBrandIds: [7, 9] });
    expect(mockSet).toHaveBeenCalledWith(
      'shop.example.com',
      [7, 9],
      expect.anything(),
    );
  });

  it('accepts an empty list, which hides nothing', async () => {
    await expect(
      putHandler(req('shop.example.com', { brandIds: [] })),
    ).resolves.toEqual({ tenantId: 'shop', guestHiddenBrandIds: [] });
  });

  it('404s for a hostname no tenant claims', async () => {
    await expect(
      putHandler(req('nobody.example.com', { brandIds: [7] })),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('refuses an invalid body without writing', async () => {
    await expect(
      putHandler(req('shop.write-guard.example.com', { brandIds: [7, 7] })),
    ).rejects.toThrow();
    expect(mockSet).not.toHaveBeenCalledWith(
      'shop.write-guard.example.com',
      expect.anything(),
      expect.anything(),
    );
  });

  it('authorizes before reading the body', async () => {
    await expect(
      putHandler(
        req(
          'other.forbidden.example.com',
          { brandIds: [7] },
          'FORBIDDEN: not this hostname',
        ),
      ),
    ).rejects.toThrow('FORBIDDEN');
    expect(mockSet).not.toHaveBeenCalledWith(
      'other.forbidden.example.com',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('UpdateTenantGuestHiddenBrandsSchema', () => {
  const parse = (body: unknown) =>
    UpdateTenantGuestHiddenBrandsSchema.safeParse(body).success;

  it('accepts positive integer ids, and an empty list', () => {
    expect(parse({ brandIds: [7, 9, 120] })).toBe(true);
    expect(parse({ brandIds: [] })).toBe(true);
  });

  it('accepts exactly 500 ids and refuses 501', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect(parse({ brandIds: ids(500) })).toBe(true);
    expect(parse({ brandIds: ids(501) })).toBe(false);
  });

  it('refuses duplicates, zero, negatives, fractions and strings', () => {
    for (const brandIds of [[7, 7], [0], [-1], [1.5], ['7'], [null]]) {
      expect(parse({ brandIds }), JSON.stringify(brandIds)).toBe(false);
    }
  });

  it('refuses a missing list, a non-array and unknown fields', () => {
    expect(parse({})).toBe(false);
    expect(parse({ brandIds: 7 })).toBe(false);
    expect(parse({ brandIds: [7], hostname: 'x' })).toBe(false);
  });
});

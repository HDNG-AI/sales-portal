import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
  requireOdelcoOrderOwnership,
  requireOdelcoSummaryOwnership,
  requireVerifiedCheckoutBuyer,
  requiresVerifiedCheckoutBuyer,
} from '../../server/utils/checkout-access';

const { optionalAuth, decodeJwtPayload, getUser, listOrders } = vi.hoisted(
  () => ({
    optionalAuth: vi.fn(),
    decodeJwtPayload: vi.fn(),
    getUser: vi.fn(),
    listOrders: vi.fn(),
  }),
);
vi.mock('../../server/utils/auth', () => ({ optionalAuth, decodeJwtPayload }));
vi.mock('../../server/services/user', () => ({ getUser }));
vi.mock('../../server/services/orders', () => ({ listOrders }));

function tenantEvent(
  id: string,
  features: Record<string, unknown> = {},
): H3Event {
  return {
    context: { tenant: { tenantId: id, config: { tenantId: id, features } } },
  } as unknown as H3Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  optionalAuth.mockResolvedValue(null);
  decodeJwtPayload.mockReturnValue({
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  getUser.mockResolvedValue({ id: 12, email: 'buyer@example.test' });
  listOrders.mockResolvedValue({
    orders: [
      { id: 104, publicId: 'public-104', customerId: 77 },
      { id: 105, publicId: 'public-105', customerId: 77 },
      { id: 106, publicId: 'public-106', customerId: null },
    ],
    total: 3,
  });
});

describe('checkout buyer policy', () => {
  it('keeps Odelco private even when its feature setting disappears', () => {
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('odelco'))).toBe(true);
  });
  it('requires verified buyers for other authenticated-price or authenticated-order tenants', () => {
    expect(
      requiresVerifiedCheckoutBuyer(
        tenantEvent('private-prices', {
          priceVisibility: { enabled: true, access: 'authenticated' },
        }),
      ),
    ).toBe(true);
    expect(
      requiresVerifiedCheckoutBuyer(
        tenantEvent('private-orders', {
          orderPlacement: { enabled: true, access: 'authenticated' },
        }),
      ),
    ).toBe(true);
  });
  it('treats a request with no resolved tenant config as private', () => {
    // e.g. ?preview=1 when the merchant API fails: only { hostname } is set.
    expect(
      requiresVerifiedCheckoutBuyer({
        context: { tenant: { hostname: 'shop.example' } },
      } as unknown as H3Event),
    ).toBe(true);
    expect(
      requiresVerifiedCheckoutBuyer({ context: {} } as unknown as H3Event),
    ).toBe(true);
  });
  it('retains genuine public-checkout guest compatibility', () => {
    expect(
      requiresVerifiedCheckoutBuyer(
        tenantEvent('public', {
          priceVisibility: { enabled: true, access: 'all' },
        }),
      ),
    ).toBe(false);
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('public'))).toBe(false);
  });
});

describe('requireVerifiedCheckoutBuyer', () => {
  const event = () => tenantEvent('odelco');
  it('denies a guest without contacting Geins', async () => {
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('denies a preview-only access token (no refresh token)', async () => {
    optionalAuth.mockResolvedValue({ authToken: 'preview', refreshToken: '' });
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('denies expired sessions without contacting Geins', async () => {
    optionalAuth.mockResolvedValue({
      authToken: 'expired',
      refreshToken: 'refresh',
    });
    decodeJwtPayload.mockReturnValue({
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('denies a fake or missing Geins profile', async () => {
    optionalAuth.mockResolvedValue({
      authToken: 'fake',
      refreshToken: 'refresh',
    });
    getUser.mockResolvedValue(undefined);
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getUser).toHaveBeenCalledTimes(1);
  });
  it('fails closed when Geins CRM is unavailable', async () => {
    optionalAuth.mockResolvedValue({
      authToken: 'network',
      refreshToken: 'refresh',
    });
    getUser.mockRejectedValue(new Error('network unavailable'));
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({
      statusCode: 401,
    });
  });
  it('accepts a profile verified over CRM, with no cached decision', async () => {
    optionalAuth.mockResolvedValue({
      authToken: 'valid',
      refreshToken: 'refresh',
    });
    await requireVerifiedCheckoutBuyer(event());
    await requireVerifiedCheckoutBuyer(event());
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});

describe('Odelco company-scoped order ownership', () => {
  const tokens = { authToken: 'valid-token', refreshToken: 'valid-refresh' };
  const event = () => tenantEvent('odelco');
  const summary = (orderId?: string) => ({ order: { orderId } });

  it('permits a company order by its internal order ID', async () => {
    await requireOdelcoSummaryOwnership(event(), tokens, summary('104'));
    expect(listOrders).toHaveBeenCalledOnce();
  });

  it('permits a legacy company order with no customerId', async () => {
    await requireOdelcoSummaryOwnership(event(), tokens, summary('106'));
    expect(listOrders).toHaveBeenCalledOnce();
  });

  it('permits orders of deactivated colleagues because order membership is company-scoped', async () => {
    // The company order list contains the order even if its placing buyer left.
    await requireOdelcoSummaryOwnership(event(), tokens, summary('105'));
    expect(listOrders).toHaveBeenCalledOnce();
  });

  it('permits a company order by its opaque public order ID', async () => {
    await requireOdelcoOrderOwnership(event(), tokens, 'public-104', 'public');
    expect(listOrders).toHaveBeenCalledOnce();
  });

  it('never mistakes internal order IDs for public order IDs', async () => {
    await expect(
      requireOdelcoOrderOwnership(event(), tokens, '104', 'public'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('denies other companies public or internal IDs', async () => {
    await expect(
      requireOdelcoSummaryOwnership(event(), tokens, summary('901')),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      requireOdelcoOrderOwnership(
        event(),
        tokens,
        'foreign-order-id',
        'public',
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('denies missing/malformed internal IDs without consulting Geins', async () => {
    for (const id of [undefined, '', 'abc', 'abc123']) {
      await expect(
        requireOdelcoSummaryOwnership(event(), tokens, summary(id)),
      ).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(listOrders).not.toHaveBeenCalled();
  });

  it('denies a missing public order ID', async () => {
    await expect(
      requireOdelcoOrderOwnership(event(), tokens, null, 'public'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(listOrders).not.toHaveBeenCalled();
  });

  it('fails closed on unavailable or empty scoped company order listing', async () => {
    listOrders.mockRejectedValueOnce(new Error('Upstream unavailable'));
    await expect(
      requireOdelcoSummaryOwnership(event(), tokens, summary('104')),
    ).rejects.toMatchObject({ statusCode: 404 });
    listOrders.mockResolvedValueOnce({ orders: [], total: 0 });
    await expect(
      requireOdelcoOrderOwnership(event(), tokens, 'public-104', 'public'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('checks ownership with the verified token, not the request cookie', async () => {
    await requireOdelcoOrderOwnership(event(), tokens, 'public-104', 'public');
    expect(listOrders).toHaveBeenCalledWith(expect.anything(), 'valid-token');
  });

  it('enforces company ownership when the tenant config is unresolved', async () => {
    const unresolved = () =>
      ({
        context: { tenant: { hostname: 'shop.example' } },
      }) as unknown as H3Event;
    await expect(
      requireOdelcoOrderOwnership(
        unresolved(),
        tokens,
        'foreign-order-id',
        'public',
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      requireOdelcoSummaryOwnership(unresolved(), tokens, summary('901')),
    ).rejects.toMatchObject({ statusCode: 404 });
    await requireOdelcoOrderOwnership(
      unresolved(),
      tokens,
      'public-104',
      'public',
    );
    expect(listOrders).toHaveBeenCalledTimes(3);
  });

  it('leaves other tenants unchanged pending separate #42 policy', async () => {
    await requireOdelcoSummaryOwnership(
      tenantEvent('public'),
      tokens,
      summary(),
    );
    expect(listOrders).not.toHaveBeenCalled();
  });
});

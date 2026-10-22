import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

// Runs the real routes with the real checkout-access gate. Only Geins and the
// cookie readers are mocked. Reproduces a ?preview=1 request whose merchant
// API call failed, so the tenant context carries a hostname and no config.

const {
  optionalAuth,
  requireAuth,
  decodeJwtPayload,
  getUser,
  getSummary,
  getOrder,
  listOrders,
} = vi.hoisted(() => ({
  optionalAuth: vi.fn(),
  requireAuth: vi.fn(),
  decodeJwtPayload: vi.fn(),
  getUser: vi.fn(),
  getSummary: vi.fn(),
  getOrder: vi.fn(),
  listOrders: vi.fn(),
}));
vi.mock('../../../../server/utils/auth', () => ({
  optionalAuth,
  requireAuth,
  decodeJwtPayload,
}));
vi.mock('../../../../server/services/user', () => ({ getUser }));
vi.mock('../../../../server/services/checkout', () => ({ getSummary }));
vi.mock('../../../../server/services/orders', () => ({ getOrder, listOrders }));

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn);
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('withErrorHandling', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal(
  'getRouterParam',
  vi.fn(() => 'foreign-order-id'),
);
vi.stubGlobal(
  'getValidatedQuery',
  vi.fn(async (_event: unknown, parse: (input: unknown) => unknown) =>
    parse({ orderId: 'foreign-order-id', paymentMethod: 'invoice' }),
  ),
);
vi.stubGlobal('ErrorCode', {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  BAD_REQUEST: 'BAD_REQUEST',
});
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, message: string) =>
    Object.assign(new Error(message), {
      statusCode:
        code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : 400,
    }),
  ),
);

const unresolvedTenant = () =>
  ({ context: { tenant: { hostname: 'shop.example' } } }) as unknown as H3Event;

beforeEach(() => {
  vi.clearAllMocks();
  decodeJwtPayload.mockReturnValue({
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  getSummary.mockResolvedValue({ order: { orderId: '901' } });
  getOrder.mockResolvedValue({ publicId: 'foreign-order-id' });
  listOrders.mockResolvedValue({
    orders: [{ id: 104, publicId: 'own-order-id' }],
    total: 1,
  });
});

describe('order routes with an unresolved tenant config', () => {
  it('denies an anonymous checkout summary without reading the order', async () => {
    optionalAuth.mockResolvedValue(null);
    const { default: handler } =
      await import('../../../../server/api/checkout/summary.get');
    await expect(handler(unresolvedTenant())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getSummary).not.toHaveBeenCalled();
  });

  it('denies order detail for an arbitrary auth_token that Geins does not verify', async () => {
    optionalAuth.mockResolvedValue({
      authToken: 'forged',
      refreshToken: 'forged',
    });
    getUser.mockRejectedValue(new Error('invalid token'));
    const { default: handler } =
      await import('../../../../server/api/orders/[id].get');
    await expect(handler(unresolvedTenant())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(requireAuth).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('denies a verified buyer another company order', async () => {
    optionalAuth.mockResolvedValue({
      authToken: 'valid',
      refreshToken: 'refresh',
    });
    getUser.mockResolvedValue({ id: 12 });
    const { default: orderHandler } =
      await import('../../../../server/api/orders/[id].get');
    await expect(orderHandler(unresolvedTenant())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(getOrder).not.toHaveBeenCalled();

    const { default: summaryHandler } =
      await import('../../../../server/api/checkout/summary.get');
    await expect(summaryHandler(unresolvedTenant())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(listOrders).toHaveBeenCalledWith(expect.anything(), 'valid');
  });
});

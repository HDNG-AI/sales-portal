import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

const { mockRequiresPrivateBuyer, mockVerifyBuyer, mockOwner } = vi.hoisted(
  () => ({
    mockRequiresPrivateBuyer: vi.fn(),
    mockVerifyBuyer: vi.fn(),
    mockOwner: vi.fn(),
  }),
);
// The session gates are stubbed. The ownership check is a spy around the real
// helper, so the membership tests below run its actual rules against the
// mocked getCompanyOrders list, and the wiring tests can still assert or
// override the call.
vi.mock('../../../../server/utils/checkout-access', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../../server/utils/checkout-access')
    >();
  mockOwner.mockImplementation(actual.requireCompanyOrderOwnership);
  return {
    requiresVerifiedCheckoutBuyer: mockRequiresPrivateBuyer,
    requireVerifiedCheckoutBuyer: mockVerifyBuyer,
    requireCompanyOrderOwnership: mockOwner,
  };
});

// Mock auth
const mockRequireAuth = vi.fn();
vi.mock('../../../../server/utils/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
vi.mock('../../../../server/services/user', () => ({ getUser: vi.fn() }));

// Mock orders service
const mockGetOrder = vi.fn();
const mockListOrders = vi.fn();
vi.mock('../../../../server/services/orders', () => ({
  getOrder: (...args: unknown[]) => mockGetOrder(...args),
  listOrders: (...args: unknown[]) => mockListOrders(...args),
}));

// Stub auto-imports
vi.stubGlobal(
  'withErrorHandling',
  vi.fn(async (fn: () => Promise<unknown>) => fn()),
);
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, message: string) => {
    const err = new Error(message) as Error & {
      statusCode: number;
      statusMessage: string;
    };
    err.statusCode =
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'NOT_FOUND'
          ? 404
          : code === 'BAD_REQUEST'
            ? 400
            : 500;
    err.statusMessage = message;
    return err;
  }),
);
vi.stubGlobal('ErrorCode', {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});
vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn);
vi.stubGlobal('getRouterParam', vi.fn());
vi.stubGlobal('setResponseHeader', vi.fn());

let handler: (event: H3Event) => Promise<unknown>;

// Access the mocked getRouterParam
const mockedGetRouterParam = vi.mocked(getRouterParam);

const odelcoEvent = () =>
  ({
    context: { tenant: { tenantId: 'odelco' } },
  }) as unknown as H3Event;

describe('GET /api/orders/[id]', () => {
  const mockEvent = {} as H3Event;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequiresPrivateBuyer.mockReturnValue(false);
    mockVerifyBuyer.mockResolvedValue({
      authToken: 'verified',
      refreshToken: 'refresh',
    });
    mockListOrders.mockResolvedValue({
      orders: [{ publicId: 'abc-123' }],
      total: 1,
    });
    handler = (await import('../../../../server/api/orders/[id].get'))
      .default as unknown as (event: H3Event) => Promise<unknown>;
  });

  it('returns 401 when not authenticated', async () => {
    const authError = new Error('Authentication required') as Error & {
      statusCode: number;
    };
    authError.statusCode = 401;
    mockRequireAuth.mockRejectedValueOnce(authError);

    await expect(handler(mockEvent)).rejects.toThrow('Authentication required');
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('marks an early 401 private, no-store too', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('Authentication required'));
    await expect(handler(mockEvent)).rejects.toThrow('Authentication required');
    expect(setResponseHeader).toHaveBeenCalledWith(
      mockEvent,
      'Cache-Control',
      'private, no-store',
    );
  });

  it('returns order detail on success', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'test-token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');

    const orderData = {
      id: 1,
      publicId: 'abc-123',
      status: 'Placed',
      createdAt: '2026-01-01',
    };
    mockGetOrder.mockResolvedValueOnce(orderData);

    const result = await handler(mockEvent);

    expect(mockRequireAuth).toHaveBeenCalledWith(mockEvent);
    expect(mockGetOrder).toHaveBeenCalledWith(
      { publicOrderId: 'abc-123' },
      mockEvent,
    );
    expect(result).toEqual({ order: orderData });
  });

  it('checks company order ownership for a public tenant too, with the session token', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'test-token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockGetOrder.mockResolvedValueOnce({ publicId: 'abc-123' });

    await handler(mockEvent);

    expect(mockVerifyBuyer).not.toHaveBeenCalled();
    expect(mockOwner).toHaveBeenCalledWith(
      mockEvent,
      { authToken: 'test-token', refreshToken: 'refresh' },
      'abc-123',
      'public',
    );
    expect(mockListOrders).toHaveBeenCalledWith(mockEvent, 'test-token');
  });

  it('verifies Odelco buyer and checks company order ownership before returning order', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('opaque-id');
    mockListOrders.mockResolvedValueOnce({
      orders: [{ publicId: 'opaque-id' }],
      total: 1,
    });
    const order = { publicId: 'opaque-id', customerId: '77', status: 'Placed' };
    mockGetOrder.mockResolvedValueOnce(order);
    const event = odelcoEvent();
    const result = await handler(event);
    expect(mockVerifyBuyer).toHaveBeenCalledWith(event);
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockOwner).toHaveBeenCalledWith(
      event,
      { authToken: 'verified', refreshToken: 'refresh' },
      'opaque-id',
      'public',
    );
    // The verified token, not the request cookie.
    expect(mockListOrders).toHaveBeenCalledWith(event, 'verified');
    expect(result).toEqual({ order });
    expect(setResponseHeader).toHaveBeenCalledWith(
      event,
      'Cache-Control',
      'private, no-store',
    );
  });

  it('rejects another company order before reading any detail from Geins', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('other-company-id');
    mockOwner.mockRejectedValueOnce(
      Object.assign(new Error('Order not found'), { statusCode: 404 }),
    );
    const event = odelcoEvent();
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockOwner).toHaveBeenCalledWith(
      event,
      { authToken: 'verified', refreshToken: 'refresh' },
      'other-company-id',
      'public',
    );
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('enforces company ownership for a private tenant other than Odelco', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('other-company-id');
    const event = {
      context: {
        tenant: {
          tenantId: 'private-prices',
          config: {
            tenantId: 'private-prices',
            features: {
              priceVisibility: { enabled: true, access: 'authenticated' },
            },
          },
        },
      },
    } as unknown as H3Event;
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockVerifyBuyer).toHaveBeenCalledWith(event);
    expect(mockListOrders).toHaveBeenCalledWith(event, 'verified');
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('enforces company ownership when the tenant config is unresolved', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('other-company-id');
    const event = {
      context: { tenant: { hostname: 'shop.example' } },
    } as unknown as H3Event;
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockVerifyBuyer).toHaveBeenCalledWith(event);
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('never returns an order whose public ID differs from the one authorized', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('own-company-id');
    mockListOrders.mockResolvedValueOnce({
      orders: [{ publicId: 'own-company-id' }],
      total: 1,
    });
    mockGetOrder.mockResolvedValueOnce({ publicId: 'other-company-id' });
    await expect(handler(odelcoEvent())).rejects.toThrow('Order not found');
  });

  it('never returns a different order than the one authorized on a public tenant', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockGetOrder.mockResolvedValueOnce({ publicId: 'other-company-id' });
    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
  });

  it('marks order detail private, no-store for every tenant', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockGetOrder.mockResolvedValueOnce({ publicId: 'abc-123' });
    await handler(mockEvent);
    expect(setResponseHeader).toHaveBeenCalledWith(
      mockEvent,
      'Cache-Control',
      'private, no-store',
    );
  });

  it('does not fetch order data when CRM buyer validation fails', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockVerifyBuyer.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    );
    await expect(handler(odelcoEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockListOrders).not.toHaveBeenCalled();
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('rejects a foreign order before fetching any public order detail', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('foreign-order');
    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('denies detail access when the current company has no visible orders', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockListOrders.mockResolvedValueOnce({ orders: [], total: 0 });
    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('fails closed if the company order list is unavailable', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockListOrders.mockRejectedValueOnce(
      new Error('company lookup unavailable'),
    );
    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('returns 404 when order not found', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'test-token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('nonexistent');
    mockListOrders.mockResolvedValueOnce({
      orders: [{ publicId: 'nonexistent' }],
      total: 1,
    });
    mockGetOrder.mockResolvedValueOnce(undefined);

    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
  });

  it('denies a foreign order even when the company has other orders', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('company-b-order');
    mockListOrders.mockResolvedValueOnce({
      orders: [{ publicId: 'company-a-1' }, { publicId: 'company-a-2' }],
      total: 2,
    });
    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('never matches an order on a near-miss of its public id', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-12');
    mockListOrders.mockResolvedValueOnce({
      orders: [
        { publicId: 'abc-123' },
        { publicId: undefined },
        { publicId: null },
      ],
      total: 3,
    });
    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('re-checks company membership on every request', async () => {
    // Request 1: the user belongs to the company that placed the order.
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockListOrders.mockResolvedValueOnce({
      orders: [{ publicId: 'abc-123' }],
      total: 1,
    });
    mockGetOrder.mockResolvedValueOnce({ publicId: 'abc-123' });
    await expect(handler(mockEvent)).resolves.toEqual({
      order: { publicId: 'abc-123' },
    });

    // Request 2: the user has moved to another company, whose list no longer
    // holds the order. Nothing from request 1 may be reused.
    const laterEvent = {} as H3Event;
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token-2',
      refreshToken: 'refresh-2',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockListOrders.mockResolvedValueOnce({
      orders: [{ publicId: 'other-co-1' }],
      total: 1,
    });
    await expect(handler(laterEvent)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockListOrders).toHaveBeenCalledTimes(2);
    expect(mockListOrders).toHaveBeenNthCalledWith(1, mockEvent, 'token');
    expect(mockListOrders).toHaveBeenNthCalledWith(2, laterEvent, 'token-2');
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('does not look up orders for an unauthenticated request', async () => {
    const authError = new Error('Authentication required');
    mockRequireAuth.mockRejectedValueOnce(authError);
    await expect(handler(mockEvent)).rejects.toThrow('Authentication required');
    expect(mockListOrders).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when id param is missing', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'test-token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce(undefined);

    await expect(handler(mockEvent)).rejects.toThrow();
  });
});

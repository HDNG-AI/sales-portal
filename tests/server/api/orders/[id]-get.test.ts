import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

// Mock auth
const mockRequireAuth = vi.fn();
vi.mock('../../../../server/utils/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

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

describe('GET /api/orders/[id]', () => {
  const mockEvent = {} as H3Event;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  it('rejects a foreign order before fetching any public order detail', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('foreign-order');
    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('denies detail access when the current company has no visible orders', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('abc-123');
    mockListOrders.mockResolvedValueOnce({ orders: [], total: 0 });
    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
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
    await expect(handler(mockEvent)).rejects.toThrow(
      'company lookup unavailable',
    );
    expect(mockGetOrder).not.toHaveBeenCalled();
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

  it('marks the response private, no-store so no cache keeps order details', async () => {
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
    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
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
    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
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
    await expect(handler(laterEvent)).rejects.toThrow('Order not found');

    expect(mockListOrders).toHaveBeenCalledTimes(2);
    expect(mockListOrders).toHaveBeenNthCalledWith(1, mockEvent);
    expect(mockListOrders).toHaveBeenNthCalledWith(2, laterEvent);
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

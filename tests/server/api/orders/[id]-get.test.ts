import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

const { mockRequiresPrivateBuyer, mockVerifyBuyer, mockOwner } = vi.hoisted(() => ({
  mockRequiresPrivateBuyer: vi.fn(),
  mockVerifyBuyer: vi.fn(),
  mockOwner: vi.fn(),
}));
vi.mock('../../../../server/utils/checkout-access', () => ({
  requiresVerifiedCheckoutBuyer: mockRequiresPrivateBuyer,
  requireVerifiedCheckoutBuyer: mockVerifyBuyer,
  requireOdelcoOrderOwnership: mockOwner,
}));

// Mock auth
const mockRequireAuth = vi.fn();
vi.mock('../../../../server/utils/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

// Mock orders service
const mockGetOrder = vi.fn();
vi.mock('../../../../server/services/orders', () => ({
  getOrder: (...args: unknown[]) => mockGetOrder(...args),
  listOrders: vi.fn(),
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
    mockRequiresPrivateBuyer.mockReturnValue(false);
    mockVerifyBuyer.mockResolvedValue({ authToken: 'verified', refreshToken: 'refresh' });
    mockOwner.mockResolvedValue(undefined);
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

  it('verifies Odelco buyer and checks company order ownership before returning order', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('opaque-id');
    const order = { publicId: 'opaque-id', customerId: '77', status: 'Placed' };
    mockGetOrder.mockResolvedValueOnce(order);
    const event = { context: { tenant: { tenantId: 'odelco' } } } as unknown as H3Event;
    const result = await handler(event);
    expect(mockVerifyBuyer).toHaveBeenCalledWith(event);
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockOwner).toHaveBeenCalledWith(event,
      { authToken: 'verified', refreshToken: 'refresh' }, '77');
    expect(result).toEqual({ order });
    expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'private, no-store');
  });

  it('never returns a different company order even when Geins returns it', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockedGetRouterParam.mockReturnValueOnce('other-company-id');
    mockGetOrder.mockResolvedValueOnce({ publicId: 'other-company-id', customerId: '9000' });
    mockOwner.mockRejectedValueOnce(Object.assign(new Error('Order not found'), { statusCode: 404 }));
    await expect(handler({ context: { tenant: { tenantId: 'odelco' } } } as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not fetch order data when CRM buyer validation fails', async () => {
    mockRequiresPrivateBuyer.mockReturnValue(true);
    mockVerifyBuyer.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    await expect(handler({ context: { tenant: { tenantId: 'odelco' } } } as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 401 });
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('returns 404 when order not found', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authToken: 'test-token',
      refreshToken: 'refresh',
    });
    mockedGetRouterParam.mockReturnValueOnce('nonexistent');
    mockGetOrder.mockResolvedValueOnce(undefined);

    await expect(handler(mockEvent)).rejects.toThrow('Order not found');
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSummary, optionalAuth, requiresVerifiedCheckoutBuyer, requireVerifiedCheckoutBuyer, requireOdelcoSummaryOwnership } = vi.hoisted(() => ({
  getSummary: vi.fn(),
  optionalAuth: vi.fn(),
  requiresVerifiedCheckoutBuyer: vi.fn(),
  requireVerifiedCheckoutBuyer: vi.fn(),
  requireOdelcoSummaryOwnership: vi.fn(),
}));
vi.mock('../../../../server/services/checkout', () => ({ getSummary }));
vi.mock('../../../../server/utils/auth', () => ({ optionalAuth }));
vi.mock('../../../../server/utils/checkout-access', () => ({
  requiresVerifiedCheckoutBuyer,
  requireVerifiedCheckoutBuyer,
  requireOdelcoSummaryOwnership,
}));

vi.stubGlobal('defineEventHandler', (fn: (...args: unknown[]) => unknown) => fn);
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('ErrorCode', { NOT_FOUND: 'NOT_FOUND' });
vi.stubGlobal('createAppError', vi.fn((_code: unknown, message: string) => Object.assign(new Error(message), { statusCode: 404 })));
vi.stubGlobal('getValidatedQuery', vi.fn(async (_event: unknown, parse: (input: unknown) => unknown) => parse({
  orderId: 'known-test-order',
  paymentMethod: 'invoice',
})));
vi.stubGlobal('withErrorHandling', async (fn: () => Promise<unknown>) => fn());

const event = { context: { tenant: { tenantId: 'odelco' } } } as unknown as import('h3').H3Event;

beforeEach(() => {
  vi.clearAllMocks();
  getSummary.mockResolvedValue({ order: { id: 'known-test-order', customerId: 77 } });
  optionalAuth.mockResolvedValue(null);
  requireVerifiedCheckoutBuyer.mockResolvedValue({ authToken: 'verified', refreshToken: 'refresh' });
  requireOdelcoSummaryOwnership.mockResolvedValue(undefined);
  requiresVerifiedCheckoutBuyer.mockReturnValue(true);
});

describe('GET /api/checkout/summary', () => {
  it('requires Geins-verified session for private buyers before reading any order data', async () => {
    const { default: handler } = await import('../../../../server/api/checkout/summary.get');
    const result = await handler(event);
    expect(requireVerifiedCheckoutBuyer).toHaveBeenCalledWith(event);
    expect(optionalAuth).not.toHaveBeenCalled();
    expect(getSummary).toHaveBeenCalledWith({
      orderId: 'known-test-order', paymentMethod: 'invoice',
    }, event);
    expect(requireOdelcoSummaryOwnership).toHaveBeenCalledWith(event,
      { authToken: 'verified', refreshToken: 'refresh' },
      { order: { id: 'known-test-order', customerId: 77 } });
    expect(result).toEqual({ order: { id: 'known-test-order', customerId: 77 } });
    expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'private, no-store');
  });

  it('denies anonymous/expired private buyer without touching OMS', async () => {
    const { default: handler } = await import('../../../../server/api/checkout/summary.get');
    requireVerifiedCheckoutBuyer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
    expect(getSummary).not.toHaveBeenCalled();
  });

  it('rejects a verified buyer trying to read another company order', async () => {
    const { default: handler } = await import('../../../../server/api/checkout/summary.get');
    requireOdelcoSummaryOwnership.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 404 }));
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  it('preserves legacy public-price post-payment guest summary', async () => {
    requiresVerifiedCheckoutBuyer.mockReturnValue(false);
    const { default: handler } = await import('../../../../server/api/checkout/summary.get');
    const result = await handler(event);
    expect(optionalAuth).toHaveBeenCalledWith(event);
    expect(requireVerifiedCheckoutBuyer).not.toHaveBeenCalled();
    expect(requireOdelcoSummaryOwnership).not.toHaveBeenCalled();
    expect(result).toEqual({ order: { id: 'known-test-order', customerId: 77 } });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { requireOdelcoSummaryOwnership, requireVerifiedCheckoutBuyer, requiresVerifiedCheckoutBuyer } from '../../server/utils/checkout-access';

const { optionalAuth, decodeJwtPayload, getUser, getCompany } = vi.hoisted(() => ({
  optionalAuth: vi.fn(),
  decodeJwtPayload: vi.fn(),
  getUser: vi.fn(),
  getCompany: vi.fn(),
}));
vi.mock('../../server/utils/auth', () => ({ optionalAuth, decodeJwtPayload }));
vi.mock('../../server/services/user', () => ({ getUser }));
vi.mock('../../server/services/company', () => ({ getCompany }));

function tenantEvent(id: string, features: Record<string, unknown> = {}): H3Event {
  return { context: { tenant: { tenantId: id, config: { tenantId: id, features } } } } as unknown as H3Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  optionalAuth.mockResolvedValue(null);
  decodeJwtPayload.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
  getUser.mockResolvedValue({ id: 12, email: 'buyer@example.test' });
  getCompany.mockResolvedValue({ id: 'company-a', buyers: [{ internalId: '77', active: true }] });
});

describe('checkout buyer policy', () => {
  it('keeps Odelco private even when its feature setting disappears', () => {
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('odelco'))).toBe(true);
  });
  it('requires verified buyers for other authenticated-price or authenticated-order tenants', () => {
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('private-prices', { priceVisibility: { enabled: true, access: 'authenticated' } }))).toBe(true);
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('private-orders', { orderPlacement: { enabled: true, access: 'authenticated' } }))).toBe(true);
  });
  it('retains genuine public-checkout guest compatibility', () => {
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('public', { priceVisibility: { enabled: true, access: 'all' } }))).toBe(false);
    expect(requiresVerifiedCheckoutBuyer(tenantEvent('public'))).toBe(false);
  });
});

describe('requireVerifiedCheckoutBuyer', () => {
  const event = () => tenantEvent('odelco');
  it('denies a guest without contacting Geins', async () => {
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({ statusCode: 401 });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('denies a preview-only access token (no refresh token)', async () => {
    optionalAuth.mockResolvedValue({ authToken: 'preview', refreshToken: '' });
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({ statusCode: 401 });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('denies expired sessions without contacting Geins', async () => {
    optionalAuth.mockResolvedValue({ authToken: 'expired', refreshToken: 'refresh' });
    decodeJwtPayload.mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 1 });
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({ statusCode: 401 });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('denies a fake or missing Geins profile', async () => {
    optionalAuth.mockResolvedValue({ authToken: 'fake', refreshToken: 'refresh' });
    getUser.mockResolvedValue(undefined);
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({ statusCode: 401 });
    expect(getUser).toHaveBeenCalledTimes(1);
  });
  it('fails closed when Geins CRM is unavailable', async () => {
    optionalAuth.mockResolvedValue({ authToken: 'network', refreshToken: 'refresh' });
    getUser.mockRejectedValue(new Error('network unavailable'));
    await expect(requireVerifiedCheckoutBuyer(event())).rejects.toMatchObject({ statusCode: 401 });
  });
  it('accepts a profile verified over CRM, with no cached decision', async () => {
    optionalAuth.mockResolvedValue({ authToken: 'valid', refreshToken: 'refresh' });
    await requireVerifiedCheckoutBuyer(event());
    await requireVerifiedCheckoutBuyer(event());
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});

describe('Odelco order ownership authorization', () => {
  const order = (customerId?: number) => ({ order: { customerId } });
  const tokens = { authToken: 'valid-token', refreshToken: 'valid-refresh' };
  it('permits an order belonging to an active buyer in the authenticated company', async () => {
    await requireOdelcoSummaryOwnership(tenantEvent('odelco'), tokens, order(77));
    expect(getCompany).toHaveBeenCalledWith(expect.anything(), 'valid-token');
  });
  it('denies a different company buyer ID without revealing their order', async () => {
    await expect(requireOdelcoSummaryOwnership(tenantEvent('odelco'), tokens, order(9900)))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it('denies inactive members of the buyer roster', async () => {
    getCompany.mockResolvedValue({ id: 'company-a', buyers: [{ internalId: '77', active: false }] });
    await expect(requireOdelcoSummaryOwnership(tenantEvent('odelco'), tokens, order(77)))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it('denies a missing or invalid customer ID', async () => {
    await expect(requireOdelcoSummaryOwnership(tenantEvent('odelco'), tokens, order()))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(requireOdelcoSummaryOwnership(tenantEvent('odelco'), tokens, order(0)))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(getCompany).not.toHaveBeenCalled();
  });
  it('fails closed when company retrieval is unavailable', async () => {
    getCompany.mockRejectedValue(new Error('unavailable'));
    await expect(requireOdelcoSummaryOwnership(tenantEvent('odelco'), tokens, order(77)))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not impose Odelco-only company roster semantics on other tenants', async () => {
    await requireOdelcoSummaryOwnership(tenantEvent('public'), tokens, order());
    expect(getCompany).not.toHaveBeenCalled();
  });
});

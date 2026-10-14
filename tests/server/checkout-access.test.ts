import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { requireVerifiedCheckoutBuyer, requiresVerifiedCheckoutBuyer } from '../../server/utils/checkout-access';

const { optionalAuth, decodeJwtPayload, getUser } = vi.hoisted(() => ({
  optionalAuth: vi.fn(),
  decodeJwtPayload: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('../../server/utils/auth', () => ({ optionalAuth, decodeJwtPayload }));
vi.mock('../../server/services/user', () => ({ getUser }));

function tenantEvent(id: string, features: Record<string, unknown> = {}): H3Event {
  return { context: { tenant: { tenantId: id, config: { tenantId: id, features } } } } as unknown as H3Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  optionalAuth.mockResolvedValue(null);
  decodeJwtPayload.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
  getUser.mockResolvedValue({ id: 12, email: 'buyer@example.test' });
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('../../server/services/auth', () => ({ getUser }));

import { protectProductPrices } from '../../server/utils/price-response';

type Visibility = { enabled: boolean; access?: 'all' | 'authenticated' };

function event(visibility?: Visibility): H3Event {
  return {
    context: {
      tenant: {
        tenantId: 'odelco',
        hostname: 'odelco.se',
        config: {
          features: visibility === undefined ? {} : { priceVisibility: visibility },
        },
      },
    },
  } as unknown as H3Event;
}

function productFixture() {
  return {
    productId: 123,
    name: 'Sample product',
    unitPrice: {
      sellingPriceExVat: 100,
      sellingPriceIncVatFormatted: '125 SEK',
      regularPriceIncVat: 140,
      vat: 25,
      currency: { code: 'SEK' },
    },
    lowestPrice: { lowestPriceIncVat: 110 },
    comparisonPriceExVat: 140,
    discountCampaigns: [{ discountPercentage: 10 }],
    priceLog: [{ sellingPriceExVat: 100 }],
    variants: [{ name: 'Small', unitPrice: { sellingPriceExVat: 80 } }],
    articleNumber: 'SAMPLE',
    stock: { inStock: 3 },
  };
}

beforeEach(() => getUser.mockReset());

describe('protectProductPrices: server-side response boundary', () => {
  const restricted = { enabled: true, access: 'authenticated' as const };

  it('redacts all nested price fields from anonymous Odelco responses before SSR', async () => {
    const original = productFixture();
    const source = JSON.parse(JSON.stringify(original));
    const sanitized = await protectProductPrices(event(restricted), null, {
      products: [original],
      total: 1,
    });

    expect(sanitized).toMatchObject({
      products: [{ productId: 123, name: 'Sample product', articleNumber: 'SAMPLE',
        stock: { inStock: 3 }, variants: [{ name: 'Small' }] }],
      total: 1,
    });
    const serialized = JSON.stringify(sanitized);
    for (const forbidden of [
      'unitPrice', 'sellingPrice', 'regularPrice', 'lowestPrice',
      'comparisonPrice', 'priceLog', 'discountCampaigns', 'SEK',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(original).toEqual(source); // Cannot modify SDK objects cached elsewhere
    expect(getUser).not.toHaveBeenCalled();
  });

  it('redacts invalid sessions, rather than trusting cookie presence', async () => {
    getUser.mockResolvedValue({ succeeded: false, user: null });
    const output = await protectProductPrices(
      event(restricted), { authToken: 'invalid', refreshToken: 'invalid' },
      productFixture(),
    );
    expect(output).not.toHaveProperty('unitPrice');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('fails closed when CRM validation is unavailable', async () => {
    getUser.mockRejectedValue(new Error('Unavailable'));
    const output = await protectProductPrices(
      event(restricted), { authToken: 'any', refreshToken: 'any' },
      productFixture(),
    );
    expect(output).not.toHaveProperty('unitPrice');
  });

  it('requires both tokens before attempting validation', async () => {
    const output = await protectProductPrices(
      event(restricted), { authToken: 'impersonation-or-preview', refreshToken: '' },
      productFixture(),
    );
    expect(output).not.toHaveProperty('unitPrice');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('preserves prices after authenticated buyer identity is verified', async () => {
    getUser.mockResolvedValue({ succeeded: true, user: { userId: 'buyer-1' } });
    const original = productFixture();
    const output = await protectProductPrices(
      event(restricted), { authToken: 'valid', refreshToken: 'valid' }, original,
    );
    expect(output).toBe(original);
    expect(output.unitPrice.sellingPriceExVat).toBe(100);
  });

  it('preserves public-price behavior in tenants without a configured gate', async () => {
    const original = productFixture();
    expect(await protectProductPrices(event(), null, original)).toBe(original);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('preserves prices for all-access products', async () => {
    const original = productFixture();
    expect(await protectProductPrices(event({ enabled: true, access: 'all' }), null, original)).toBe(original);
  });

  it('redacts when the feature is disabled even with a session', async () => {
    const output = await protectProductPrices(
      event({ enabled: false, access: 'authenticated' }),
      { authToken: 'valid', refreshToken: 'valid' }, productFixture(),
    );
    expect(output).not.toHaveProperty('unitPrice');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('supports array responses without changing non-price fields', async () => {
    const results = await protectProductPrices(event(restricted), null, [productFixture()]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Sample product', productId: 123 });
    expect(results[0]).not.toHaveProperty('unitPrice');
  });
});

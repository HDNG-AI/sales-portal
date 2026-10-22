import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { protectProductPrices } from '../../server/utils/price-response';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('../../server/services/user', () => ({ getUser }));

type Visibility = { enabled: boolean; access?: 'all' | 'authenticated' };
const restricted = { enabled: true, access: 'authenticated' as const };
let tokenCounter = 0;

function event(visibility?: Visibility, tenantId = 'odelco'): H3Event {
  return {
    context: {
      tenant: {
        tenantId,
        hostname: tenantId === 'odelco' ? 'odelco.se' : 'public.example.com',
        config: {
          tenantId,
          features: visibility === undefined ? {} : { priceVisibility: visibility },
        },
      },
    },
  } as unknown as H3Event;
}

function tokens(secondsToExpiry = 3600) {
  const payload = Buffer.from(JSON.stringify({
    sub: 'test-user-' + (++tokenCounter),
    exp: Math.floor(Date.now() / 1000) + secondsToExpiry,
  })).toString('base64url');
  return { authToken: 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.test-signature',
    refreshToken: 'refresh-' + tokenCounter };
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
  it('removes nested prices from anonymous response and Nuxt SSR serialization', async () => {
    const original = productFixture();
    const source = JSON.parse(JSON.stringify(original));
    const sanitized = await protectProductPrices(event(restricted), null, {
      products: [original],
      total: 1,
    });
    expect(sanitized).toMatchObject({
      products: [{ productId: 123, name: 'Sample product',
        articleNumber: 'SAMPLE', stock: { inStock: 3 },
        variants: [{ name: 'Small' }] }],
      total: 1,
    });
    for (const forbidden of [
      'unitPrice', 'sellingPrice', 'regularPrice', 'lowestPrice',
      'comparisonPrice', 'priceLog', 'discountCampaigns', 'SEK',
    ]) {
      expect(JSON.stringify(sanitized)).not.toContain(forbidden);
    }
    expect(original).toEqual(source);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('redacts nested CartType money fields without hiding stock/count', async () => {
    const cart = {
      id: 'opaque-cart-id', totalStock: 7, totalQuantity: 2,
      totalIncVat: 570, totalExVat: 456, totalVatFormatted: '114 SEK',
      items: [{
        skuId: 50, quantity: 2,
        unitPrice: { sellingPriceIncVat: 250 },
        itemValueIncVatFormatted: '500 SEK',
        lineTotalExVat: 400,
      }],
      summary: {
        total: { sellingPriceIncVat: 500, sellingPriceExVat: 400 },
        subTotal: { sellingPriceExVat: 400 },
        paymentFeeIncVatFormatted: '25 SEK',
      },
      shipping: { feeIncVatFormatted: '45 SEK' },
      discountTotal: 50,
    };
    const source = JSON.parse(JSON.stringify(cart));
    const result = await protectProductPrices(event(restricted), null, cart);
    const serialized = JSON.stringify(result);
    for (const secret of ['sellingPrice', 'unitPrice', 'itemValue', 'lineTotal', 'feeIncVat', 'paymentFee', 'discountTotal', 'totalIncVat', 'totalExVat', 'totalVatFormatted', '500 SEK', '45 SEK', '114 SEK']) {
      expect(serialized).not.toContain(secret);
    }
    expect(result).toMatchObject({
      id: 'opaque-cart-id', totalStock: 7, totalQuantity: 2, items: [{ skuId: 50, quantity: 2 }],
    });
    expect(cart).toEqual(source);
  });

  it('removes entire Price facets even when numeric values have generic names', async () => {
    const filters = { count: 3, filters: { facets: [
      { type: 'Brand', filterId: 'Brand', values: [{ value: 'X' }] },
      { type: 'Price', filterId: 'Price', values: [{ min: 1, max: 9000 }] },
      { type: 'StockStatus', filterId: 'StockStatus', values: [] },
    ] } };
    const response = await protectProductPrices(event(restricted), null, filters);
    expect(response.filters.facets.map((x) => x.filterId)).toEqual([
      'Brand', 'StockStatus',
    ]);
    expect(JSON.stringify(response)).not.toContain('9000');
    expect(filters.filters.facets).toHaveLength(3);
  });

  it('rejects expired JWT without contacting CRM', async () => {
    const response = await protectProductPrices(event(restricted), tokens(-10), productFixture());
    expect(response).not.toHaveProperty('unitPrice');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('does not trust forged/invalid tokens merely because cookies exist', async () => {
    getUser.mockResolvedValue(undefined);
    const response = await protectProductPrices(event(restricted), tokens(), productFixture());
    expect(response).not.toHaveProperty('unitPrice');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('fails closed when network CRM validation throws', async () => {
    getUser.mockImplementationOnce(() => {
      throw new Error('Unavailable');
    });
    const response = await protectProductPrices(event(restricted), tokens(), productFixture());
    expect(response).not.toHaveProperty('unitPrice');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('denies incomplete or unauthenticated real profiles', async () => {
    getUser.mockResolvedValueOnce({ id: 4, authenticated: false });
    expect(await protectProductPrices(event(restricted), tokens(), productFixture()))
      .not.toHaveProperty('unitPrice');
    getUser.mockResolvedValueOnce({ email: 'customer@example.com' });
    expect(await protectProductPrices(event(restricted), tokens(), productFixture()))
      .not.toHaveProperty('unitPrice');
  });

  it('keeps prices only after the CRM profile confirms a buyer', async () => {
    getUser.mockResolvedValue({ id: 99, email: 'buyer@example.com' });
    const original = productFixture();
    const result = await protectProductPrices(event(restricted), tokens(), original);
    expect(result).toBe(original);
    expect(result.unitPrice.sellingPriceExVat).toBe(100);
  });

  it('does not rotate refresh tokens on a price-visibility read', async () => {
    getUser.mockResolvedValue({ id: 17 });
    const auth = tokens();
    await protectProductPrices(event(restricted), auth, productFixture());
    expect(getUser).toHaveBeenCalledWith(auth.authToken, expect.anything());
    expect(auth.refreshToken).toMatch(/^refresh-/);
  });

  it('reuses short positive cache for the same tenant/token', async () => {
    getUser.mockResolvedValue({ id: 99 });
    const auth = tokens();
    const e = event(restricted);
    expect(await protectProductPrices(e, auth, productFixture())).toHaveProperty('unitPrice');
    expect(await protectProductPrices(e, auth, productFixture())).toHaveProperty('unitPrice');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('does not grant the same JWT access under another tenant', async () => {
    getUser.mockResolvedValueOnce({ id: 77 }).mockResolvedValueOnce(undefined);
    const auth = tokens();
    expect(await protectProductPrices(event(restricted), auth, productFixture()))
      .toHaveProperty('unitPrice');
    expect(await protectProductPrices(event(restricted, 'other'), auth, productFixture()))
      .not.toHaveProperty('unitPrice');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('deduplicates parallel CRM verification attempts', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    getUser.mockReturnValue(pending);
    const auth = tokens();
    const e = event(restricted);
    const first = protectProductPrices(e, auth, productFixture());
    const second = protectProductPrices(e, auth, productFixture());
    release({ id: 11 });
    await Promise.all([first, second]);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('denies auth-token-only preview and impersonation sessions', async () => {
    const auth = { ...tokens(), refreshToken: '' };
    expect(await protectProductPrices(event(restricted), auth, productFixture()))
      .not.toHaveProperty('unitPrice');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('preserves pricing for tenants without a gate', async () => {
    const original = productFixture();
    expect(await protectProductPrices(event(undefined, 'public-store'), null, original))
      .toBe(original);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('denies pricing when Odelco loses its mandatory configuration', async () => {
    expect(await protectProductPrices(event(), null, productFixture()))
      .not.toHaveProperty('unitPrice');
  });

  it('preserves prices under an explicit all-access policy', async () => {
    const original = productFixture();
    expect(await protectProductPrices(event({ enabled: true, access: 'all' }), null, original))
      .toBe(original);
  });

  it('denies pricing for disabled feature even with cookies', async () => {
    expect(await protectProductPrices(
      event({ enabled: false, access: 'authenticated' }), tokens(), productFixture(),
    )).not.toHaveProperty('unitPrice');
    expect(getUser).not.toHaveBeenCalled();
  });
});

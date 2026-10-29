import { describe, it, expect } from 'vitest';
import {
  getStockStatus,
  formatPrice,
  purchasableQuantity,
} from '../../shared/types/commerce';

describe('purchasableQuantity', () => {
  const stock = (totalStock: number, oversellable = 0, staticStock = 0) => ({
    totalStock,
    inStock: totalStock,
    oversellable,
    static: staticStock,
  });

  it('is what is left of total stock after what the cart holds', () => {
    expect(purchasableQuantity(stock(10))).toBe(10);
    expect(purchasableQuantity(stock(10), 4)).toBe(6);
    expect(purchasableQuantity(stock(3), 5)).toBe(0);
  });

  it('is unlimited for oversellable and static stock', () => {
    expect(purchasableQuantity(stock(1000, 1000), 999)).toBe(Infinity);
    expect(purchasableQuantity(stock(0, 0, 5))).toBe(Infinity);
  });
});

describe('getStockStatus', () => {
  it('returns in-stock when totalStock > threshold', () => {
    expect(getStockStatus({ totalStock: 100, inStock: 100, static: 0 })).toBe(
      'in-stock',
    );
  });

  it('returns low-stock when totalStock <= threshold', () => {
    expect(getStockStatus({ totalStock: 3, inStock: 3, static: 0 })).toBe(
      'low-stock',
    );
  });

  it('returns out-of-stock when totalStock === 0', () => {
    expect(getStockStatus({ totalStock: 0, inStock: 0, static: 0 })).toBe(
      'out-of-stock',
    );
  });

  it('returns on-demand when static > 0 and totalStock === 0', () => {
    expect(getStockStatus({ totalStock: 0, inStock: 0, static: 10 })).toBe(
      'on-demand',
    );
  });

  it('respects custom threshold', () => {
    expect(getStockStatus({ totalStock: 8, inStock: 8, static: 0 }, 10)).toBe(
      'low-stock',
    );
    expect(getStockStatus({ totalStock: 8, inStock: 8, static: 0 }, 5)).toBe(
      'in-stock',
    );
  });

  it('on-demand takes priority over out-of-stock', () => {
    expect(getStockStatus({ totalStock: 0, inStock: 0, static: 5 })).toBe(
      'on-demand',
    );
  });
});

describe('getStockStatus on the available basis', () => {
  const stock = (totalStock: number, oversellable = 1000) => ({
    totalStock,
    inStock: 0,
    static: 0,
    oversellable,
  });

  it('subtracts oversellable before applying the threshold', () => {
    expect(getStockStatus(stock(1006), 5, 'available')).toBe('in-stock');
    expect(getStockStatus(stock(1005), 5, 'available')).toBe('low-stock');
    expect(getStockStatus(stock(1001), 5, 'available')).toBe('low-stock');
  });

  it('returns backorder at or below zero instead of out-of-stock', () => {
    expect(getStockStatus(stock(1000), 5, 'available')).toBe('backorder');
    expect(getStockStatus(stock(998), 5, 'available')).toBe('backorder');
  });

  it('follows a changed oversell allowance', () => {
    expect(getStockStatus(stock(510, 500), 5, 'available')).toBe('in-stock');
    expect(getStockStatus(stock(503, 500), 5, 'available')).toBe('low-stock');
  });

  it('treats a missing oversellable as zero', () => {
    expect(
      getStockStatus({ totalStock: 3, inStock: 3, static: 0 }, 5, 'available'),
    ).toBe('low-stock');
  });

  it('leaves the total basis unchanged by oversellable', () => {
    expect(getStockStatus(stock(998))).toBe('in-stock');
  });
});

describe('formatPrice', () => {
  it('formats with default SEK locale', () => {
    const result = formatPrice(199, 'SEK', 'sv-SE');
    expect(result).toMatch(/199/);
    expect(result).toMatch(/kr/);
  });

  it('formats with EUR', () => {
    const result = formatPrice(49.99, 'EUR', 'de-DE');
    expect(result).toMatch(/49,99/);
    expect(result).toMatch(/€/);
  });

  it('formats with USD', () => {
    const result = formatPrice(29.99, 'USD', 'en-US');
    expect(result).toContain('$');
    expect(result).toContain('29.99');
  });

  it('falls back to the "sv-SE" locale when no locale is given', () => {
    const result = formatPrice(199, 'SEK');
    expect(result).toBe(
      new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK',
      }).format(199),
    );
  });
});

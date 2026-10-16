import { describe, expect, it } from 'vitest';
import type { PriceType } from '#shared/types/commerce';
import { formatCartSummaryAmount } from '#shared/utils/cart-summary-price';

const amount = (data: Record<string, unknown>) => data as PriceType;

describe('formatCartSummaryAmount (Odelco client #24)', () => {
  it('uses the exact VAT basis selected by the buyer', () => {
    const price = amount({
      sellingPriceIncVat: 125,
      sellingPriceExVat: 100,
      sellingPriceIncVatFormatted: '125 kr',
      sellingPriceExVatFormatted: '100 kr',
      currency: { code: 'SEK' },
    });
    expect(formatCartSummaryAmount(price, false, 'sv-SE')).toBe('100 kr');
    expect(formatCartSummaryAmount(price, true, 'sv-SE')).toBe('125 kr');
  });

  it('formats a raw excl-VAT amount if the formatted value is absent', () => {
    const price = amount({
      sellingPriceIncVat: 125,
      sellingPriceIncVatFormatted: '125 kr',
      sellingPriceExVat: 100,
      currency: { code: 'SEK' },
    });
    const result = formatCartSummaryAmount(price, false, 'sv-SE');
    expect(result).toContain('100');
    expect(result).not.toContain('125');
  });

  it('never replaces a missing excl-VAT value with the incl-VAT amount', () => {
    const price = amount({
      sellingPriceIncVat: 125,
      sellingPriceIncVatFormatted: '125 kr',
    });
    expect(formatCartSummaryAmount(price, false, 'sv-SE')).toBe('');
    expect(formatCartSummaryAmount(price, true, 'sv-SE')).toBe('125 kr');
  });

  it('never replaces a missing incl-VAT value with an excl-VAT amount', () => {
    const price = amount({
      sellingPriceExVat: 100,
      sellingPriceExVatFormatted: '100 kr',
    });
    expect(formatCartSummaryAmount(price, true, 'sv-SE')).toBe('');
    expect(formatCartSummaryAmount(price, false, 'sv-SE')).toBe('100 kr');
  });

  it('handles missing, nonfinite and zero numeric amounts safely', () => {
    expect(formatCartSummaryAmount(undefined, false, 'sv-SE')).toBe('');
    expect(formatCartSummaryAmount(amount({ sellingPriceExVat: Number.NaN }), false, 'sv-SE')).toBe('');
    expect(formatCartSummaryAmount(amount({ sellingPriceExVat: Infinity }), false, 'sv-SE')).toBe('');
    expect(formatCartSummaryAmount(amount({ sellingPriceExVat: 0, currency: { code: 'SEK' } }), false, 'sv-SE')).toContain('0');
  });
});

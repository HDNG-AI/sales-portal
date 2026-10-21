/**
 * The storefront appends its own specification group built from the product
 * record's dimensions and weight, which are the packaging values that drive
 * shipping. A merchant parameter group may carry the product's own
 * dimensions under "Mått och vikt", so the Swedish heading for the packaging
 * group must not read the same.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sv = JSON.parse(
  readFileSync(resolve(__dirname, '../../app/locales/sv.json'), 'utf-8'),
) as { product: { measurements: string } };

describe('packaging specification heading (sv)', () => {
  it('labels the product-record dimensions group as packaging', () => {
    expect(sv.product.measurements).toBe('Förpackning');
  });

  it('does not reuse the product-dimensions parameter group name', () => {
    expect(sv.product.measurements).not.toBe('Mått och vikt');
  });
});

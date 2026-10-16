import type { PriceType } from '#shared/types/commerce';
import { formatPrice } from '#shared/types/commerce';

/**
 * Cart totals must use the *selected* VAT basis, just like ProductCard and
 * PriceDisplay. Falling back from a missing ex-VAT value to an inc-VAT one
 * showed a different amount after the buyer added the same product to cart.
 *
 * Prefer the API-formatted value, then format the raw amount in the same
 * currency and locale. Never substitute the opposite VAT basis, even when
 * the requested amount is missing. Missing is safer than misleading.
 */
export function formatCartSummaryAmount(
  price: PriceType | null | undefined,
  showIncVat: boolean,
  locale: string,
): string {
  if (!price) return '';
  const formatted = showIncVat
    ? price.sellingPriceIncVatFormatted
    : price.sellingPriceExVatFormatted;
  if (formatted) return formatted;

  const amount = showIncVat
    ? price.sellingPriceIncVat
    : price.sellingPriceExVat;
  if (amount == null || !Number.isFinite(amount)) return '';

  return formatPrice(amount, price.currency?.code, locale);
}

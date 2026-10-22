/**
 * How the storefront words shipping, from `layout.shippingTerms`.
 *
 * Absent or `standard` shows what the merchant's shipping options say: the
 * option's own name, and "free" for a zero fee. A tenant on `agreement`
 * charges shipping on the invoice under each buyer's contract, so a zero fee
 * is not free shipping: the zero-fee option is named as shipping by
 * agreement and its fee reads as invoiced separately, wherever the fee is
 * shown. A fee above zero is always shown as the amount it is, and a missing
 * fee keeps whatever the caller shows for an unknown one.
 */
export function useShippingTerms() {
  const { tenant } = useTenant();
  const { t } = useI18n();

  const byAgreement = computed(
    () => tenant.value?.layout?.shippingTerms === 'agreement',
  );

  // Only an explicit zero. A missing or not-yet-loaded fee is unknown, and
  // saying it is invoiced separately would assert more than the data does.
  function isUncharged(fee: number | null | undefined): boolean {
    return fee === 0;
  }

  /** The fee as a summary row shows it, or `formatted` when terms are standard. */
  function feeLabel<T extends string | null | undefined>(
    fee: number | null | undefined,
    formatted: T,
  ): string | T {
    return byAgreement.value && isUncharged(fee)
      ? t('checkout.shipping_invoiced_separately')
      : formatted;
  }

  /** A shipping option's display name. */
  function optionName(option: {
    name?: string | null;
    displayName?: string | null;
    feeIncVat?: number | null;
  }): string {
    if (byAgreement.value && isUncharged(option.feeIncVat)) {
      return t('checkout.shipping_by_agreement');
    }
    return option.displayName ?? option.name ?? '';
  }

  return { byAgreement, feeLabel, optionName };
}

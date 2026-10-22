import { describe, it, expect, beforeEach, assert } from 'vitest';
import type { ShippingOptionType } from '#shared/types/commerce';
import { mountComponent } from '../../utils/component';
import CheckoutShippingOptions from '../../../app/components/checkout/CheckoutShippingOptions.vue';
import { useTenant } from '../../../app/composables/useTenant';
import { mockShowIncVat } from '../../setup-components';

// useTenant mock is provided by setup-components.ts — write layout on its ref.
const { tenant } = useTenant();

function setShippingTerms(terms: 'standard' | 'agreement' | undefined) {
  assert.isDefined(tenant.value);
  tenant.value.layout = {
    ...(tenant.value.layout ?? {}),
    shippingTerms: terms,
  };
}

function makeOption(overrides: Partial<ShippingOptionType> = {}) {
  return {
    id: 1,
    name: 'Default',
    displayName: 'Default',
    feeIncVat: 0,
    feeIncVatFormatted: '0 kr',
    feeExVat: 0,
    feeExVatFormatted: '0 kr',
    amountLeftToFreeShipping: 0,
    ...overrides,
  } as ShippingOptionType;
}

function render(option: ShippingOptionType): string {
  const wrapper = mountComponent(CheckoutShippingOptions, {
    props: { options: [option], modelValue: option.id, disabled: false },
  });
  return wrapper.find(`[data-testid="shipping-option-${option.id}"]`).text();
}

// Registered in tests/unit/config-coverage/map.ts.
describe('CheckoutShippingOptions shippingTerms', () => {
  beforeEach(() => {
    setShippingTerms(undefined);
    mockShowIncVat.value = false;
  });

  it('shows the option name and free for a zero fee when shippingTerms is absent', () => {
    const text = render(makeOption());
    expect(text).toContain('Default');
    expect(text).toContain('checkout.free_shipping');
  });

  it('names a zero-fee option by agreement, invoiced separately, when shippingTerms is agreement', () => {
    setShippingTerms('agreement');
    const text = render(makeOption());
    expect(text).toContain('checkout.shipping_by_agreement');
    expect(text).toContain('checkout.shipping_invoiced_separately');
    expect(text).not.toContain('Default');
    expect(text).not.toContain('checkout.free_shipping');
    expect(text).not.toContain('0 kr');
  });

  it('hides the amount left to free shipping when shippingTerms is agreement', () => {
    setShippingTerms('agreement');
    const text = render(
      makeOption({
        amountLeftToFreeShipping: 100,
        amountLeftToFreeShippingFormatted: '100 kr',
      }),
    );
    expect(text).not.toContain('checkout.amount_left_free_shipping');
  });

  it('keeps a charged option as it is when shippingTerms is agreement', () => {
    setShippingTerms('agreement');
    const text = render(
      makeOption({
        displayName: 'Express',
        feeIncVat: 125,
        feeIncVatFormatted: '125 kr',
        feeExVat: 100,
        feeExVatFormatted: '100 kr',
      }),
    );
    expect(text).toContain('Express');
    // Either VAT side; which one is the VAT display's concern, not this one's.
    expect(text).toMatch(/(100|125) kr/);
    expect(text).not.toContain('checkout.shipping_invoiced_separately');
  });
});

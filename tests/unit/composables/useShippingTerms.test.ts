import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';

const mockLayout = ref<{ shippingTerms?: 'standard' | 'agreement' | null }>({});

vi.stubGlobal('useTenant', () => ({
  tenant: computed(() => ({ layout: mockLayout.value })),
}));
// The auto-import resolves to the real composable as well; see
// useVatDisplay.test.ts for why both are needed.
vi.mock('../../../app/composables/useTenant', () => ({
  useTenant: () => ({
    tenant: computed(() => ({ layout: mockLayout.value })),
  }),
}));
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.stubGlobal('computed', computed);

const { useShippingTerms } =
  await import('../../../app/composables/useShippingTerms');

describe('useShippingTerms', () => {
  beforeEach(() => {
    mockLayout.value = {};
  });

  it('passes every fee and name through on standard terms', () => {
    for (const shippingTerms of [undefined, null, 'standard'] as const) {
      mockLayout.value = { shippingTerms };
      const { byAgreement, feeLabel, optionName } = useShippingTerms();
      expect(byAgreement.value).toBe(false);
      expect(feeLabel(0, '0 kr')).toBe('0 kr');
      expect(feeLabel(undefined, null)).toBeNull();
      expect(optionName({ name: 'Default', feeIncVat: 0 })).toBe('Default');
    }
  });

  it('reads an explicit zero fee as invoiced separately on agreement terms', () => {
    mockLayout.value = { shippingTerms: 'agreement' };
    expect(useShippingTerms().feeLabel(0, '0 kr')).toBe(
      'checkout.shipping_invoiced_separately',
    );
  });

  it('leaves a missing fee unknown on agreement terms', () => {
    mockLayout.value = { shippingTerms: 'agreement' };
    const { feeLabel, optionName } = useShippingTerms();
    expect(feeLabel(null, null)).toBeNull();
    expect(feeLabel(undefined, undefined)).toBeUndefined();
    expect(feeLabel(undefined, '')).toBe('');
    expect(optionName({ name: 'Default', feeIncVat: null })).toBe('Default');
  });

  it('keeps a real fee on agreement terms', () => {
    mockLayout.value = { shippingTerms: 'agreement' };
    expect(useShippingTerms().feeLabel(49, '49 kr')).toBe('49 kr');
  });

  it('names only a zero-fee option as shipping by agreement', () => {
    mockLayout.value = { shippingTerms: 'agreement' };
    const { optionName } = useShippingTerms();
    expect(
      optionName({ name: 'Default', displayName: 'Default', feeIncVat: 0 }),
    ).toBe('checkout.shipping_by_agreement');
    expect(optionName({ displayName: 'Express', feeIncVat: 125 })).toBe(
      'Express',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { mountComponent } from '../../utils/component';
import PriceSlot from '../../../app/components/shared/PriceSlot.vue';

const price = {
  sellingPriceIncVat: 199,
  sellingPriceExVat: 159.2,
  regularPriceIncVat: 199,
  regularPriceExVat: 159.2,
  sellingPriceIncVatFormatted: '199,00 kr',
  sellingPriceExVatFormatted: '159,20 kr',
  regularPriceIncVatFormatted: '199,00 kr',
  regularPriceExVatFormatted: '159,20 kr',
  isDiscounted: false,
  discountPercentage: 0,
  currency: { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
};

const stubs = {
  NuxtLink: {
    template:
      '<a data-testid="nuxt-link" :data-path="to.path" :data-redirect="to.query.redirect"><slot /></a>',
    props: ['to'],
  },
  PriceDisplay: {
    template: '<span data-testid="price-display">price</span>',
    props: [
      'price',
      'showVat',
      'showDiscount',
      'fromPrice',
      'lowestPrice',
      'discountType',
      'campaignNames',
    ],
  },
  SharedPriceDisplay: {
    template: '<span data-testid="price-display">price</span>',
    props: [
      'price',
      'showVat',
      'showDiscount',
      'fromPrice',
      'lowestPrice',
      'discountType',
      'campaignNames',
    ],
  },
};

describe('PriceSlot', () => {
  it.each(['contract', 'list'] as const)(
    'renders a real price in %s state',
    (mode) => {
      const wrapper = mountComponent(PriceSlot, {
        props: { mode, price },
        global: { stubs },
      });

      expect(wrapper.find('[data-testid="price-display"]').exists()).toBe(true);
      const slot = wrapper.find('[data-testid="price-slot"]');
      expect(slot.attributes('data-price-state')).toBe(mode);
      expect(slot.classes()).toContain('h-16');
    },
  );

  it('renders the price location itself as login control and preserves product return path', () => {
    const wrapper = mountComponent(PriceSlot, {
      props: {
        mode: 'hidden',
        returnTo: '/se/sv/p/test-product',
      },
      global: { stubs },
    });

    const slot = wrapper.find('[data-testid="price-slot"]');
    const link = wrapper.find('[data-testid="price-login"]');
    expect(link.exists()).toBe(true);
    expect(wrapper.text()).toContain('product.login_for_prices');
    expect(link.attributes('data-path')).toBe('/se/en/login');
    expect(link.attributes('data-redirect')).toBe('/se/sv/p/test-product');
    expect(slot.classes()).toContain('h-16');
  });

  it('supports quote state in the same geometry and emits the quote action', async () => {
    const wrapper = mountComponent(PriceSlot, {
      props: { mode: 'quote' },
      global: { stubs },
    });

    expect(
      wrapper.find('[data-testid="price-slot"]').classes(),
    ).toContain('h-16');
    await wrapper.find('[data-testid="price-quote"]').trigger('click');
    expect(wrapper.emitted('request-quote')).toHaveLength(1);
  });
});

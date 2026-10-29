import { describe, it, expect, vi, beforeEach, assert } from 'vitest';
import type { AuthUser } from '@geins/types';
import { createPinia, setActivePinia } from 'pinia';
import type { PublicTenantConfig } from '#shared/types/tenant-config';
import { shallowMountComponent } from '../../utils/component';
import CartPage from '../../../app/components/pages/CartPage.vue';
import type { CartType } from '../../../shared/types/commerce';
import { useTenant } from '../../../app/composables/useTenant';
import { useAuthStore } from '../../../app/stores/auth';
import { useCartStore } from '../../../app/stores/cart';

// The real access chain decides here, over the tenant fixture and the
// signed-in user; see tests/setup-components.ts.
vi.unmock('../../../app/composables/useFeatureAccess');

const { tenant } = useTenant();
function setFeatures(features: PublicTenantConfig['features']) {
  assert.isDefined(tenant.value);
  tenant.value.features = features;
}

const SIGNED_IN: AuthUser = { userId: '1', username: 'buyer@example.com' };
const ON = {
  cartFileImport: { enabled: true, access: 'authenticated' as const },
};

const filledCart = {
  id: 'cart-1',
  items: [{ id: 'item-1', skuId: 100, quantity: 2 }],
  appliedCampaigns: [],
  summary: {},
} as unknown as CartType;

const buttonStub = {
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  props: ['disabled', 'variant', 'size'],
  emits: ['click'],
};
const stubs = {
  Button: buttonStub,
  CartItem: { template: '<div data-testid="cart-item" />', props: ['item'] },
  ErrorBoundary: { template: '<div><slot /></div>', props: ['section'] },
  CartPageSkeleton: { template: '<div />' },
  CartFileImportDialog: {
    props: ['open'],
    template: '<div data-testid="import-dialog" :data-open="String(open)" />',
  },
};

function mount() {
  return shallowMountComponent(CartPage, { global: { stubs } });
}

describe('CartPage — upload file', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setFeatures({});
    useAuthStore().user = null;
  });

  it('is hidden from a signed-out visitor, even with the feature on for everyone', () => {
    setFeatures({ cartFileImport: { enabled: true, access: 'all' } });
    const wrapper = mount();
    expect(
      wrapper.find('[data-testid="cart-file-import-open-empty"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-testid="import-dialog"]').exists()).toBe(false);
  });

  it('is hidden from a signed-in buyer while the tenant has not turned it on', () => {
    useAuthStore().user = SIGNED_IN;
    const wrapper = mount();
    expect(
      wrapper.find('[data-testid="cart-file-import-open-empty"]').exists(),
    ).toBe(false);

    setFeatures({ cartFileImport: { enabled: false } });
    expect(mount().find('[data-testid="import-dialog"]').exists()).toBe(false);
  });

  it('is offered in the empty cart and opens the dialog', async () => {
    useAuthStore().user = SIGNED_IN;
    setFeatures(ON);
    const wrapper = mount();
    const open = wrapper.find('[data-testid="cart-file-import-open-empty"]');
    expect(open.text()).toContain('cart.file_import.open');
    expect(wrapper.find('[data-testid="cart-file-import-open"]').exists()).toBe(
      false,
    );

    await open.trigger('click');
    expect(
      wrapper.find('[data-testid="import-dialog"]').attributes('data-open'),
    ).toBe('true');
  });

  it('is offered next to the heading of a filled cart', () => {
    useAuthStore().user = SIGNED_IN;
    setFeatures(ON);
    useCartStore().cart = filledCart;
    const wrapper = mount();
    expect(wrapper.find('[data-testid="cart-file-import-open"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="cart-file-import-open-empty"]').exists(),
    ).toBe(false);
  });

  it('keeps the dialog open when the import fills an empty cart', async () => {
    useAuthStore().user = SIGNED_IN;
    setFeatures(ON);
    const wrapper = mount();
    await wrapper
      .find('[data-testid="cart-file-import-open-empty"]')
      .trigger('click');

    useCartStore().cart = filledCart;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="cart-page-empty"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="import-dialog"]').attributes('data-open'),
    ).toBe('true');
  });
});

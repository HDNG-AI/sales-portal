import { describe, it, expect, vi, beforeEach, assert } from 'vitest';
import type { AuthUser } from '@geins/types';
import type { PublicTenantConfig } from '#shared/types/tenant-config';
import { mountComponent } from '../../utils/component';
import StockBadge from '../../../app/components/shared/StockBadge.vue';
import { useTenant } from '../../../app/composables/useTenant';
import { useAuthStore } from '../../../app/stores/auth';

// useTenant mock is provided by setup-components.ts — access tenant ref to control features
const { tenant } = useTenant();

// `useTenant()` types `tenant` as nullable because the real composable fills it
// from useFetch. The setup-components mock always provides one, so assert it
// here once instead of reaching for `!` at each site.
function setFeatures(features: PublicTenantConfig['features']) {
  assert.isDefined(tenant.value);
  tenant.value.features = features;
}

// Escapes the tier-wide mock, which answers true for every key; see
// tests/setup-components.ts. The real chain then runs over the fixture below.
vi.unmock('../../../app/composables/useFeatureAccess');

// `isAuthenticated` is `!!user.value`, so identity is all this needs to carry.
const SIGNED_IN: AuthUser = {
  userId: '1',
  username: 'buyer@example.com',
};

const badgeStub = {
  template: '<span class="badge" :class="$attrs.class"><slot /></span>',
  props: ['variant'],
};

const stubs = {
  Badge: badgeStub,
  UiBadge: badgeStub,
};

function makeStock(overrides: Record<string, number> = {}) {
  return {
    inStock: 100,
    oversellable: 0,
    totalStock: 100,
    static: 0,
    ...overrides,
  };
}

function setStockLevelBasis(basis: 'total' | 'available' | undefined) {
  assert.isDefined(tenant.value);
  tenant.value.layout = {
    ...(tenant.value.layout ?? {}),
    stockLevelBasis: basis,
  };
}

describe('StockBadge', () => {
  beforeEach(() => {
    setFeatures({});
    setStockLevelBasis(undefined);
    // Sign out: the Pinia store is shared across this file's tests.
    useAuthStore().user = null;
  });

  it('renders in-stock state with semantic success styling', () => {
    const wrapper = mountComponent(StockBadge, {
      props: { stock: makeStock() },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('product.in_stock');
    expect(wrapper.find('.badge').classes()).toContain('text-success');
  });

  it('renders low-stock state with semantic warning styling', () => {
    const wrapper = mountComponent(StockBadge, {
      props: { stock: makeStock({ totalStock: 3, inStock: 3 }) },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('product.low_stock');
    expect(wrapper.find('.badge').classes()).toContain('text-warning');
  });

  it('renders out-of-stock state', () => {
    const wrapper = mountComponent(StockBadge, {
      props: { stock: makeStock({ totalStock: 0, inStock: 0 }) },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('product.out_of_stock');
  });

  it('renders on-demand state as neutral rather than informational blue', () => {
    const wrapper = mountComponent(StockBadge, {
      props: { stock: makeStock({ totalStock: 0, inStock: 0, static: 10 }) },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('product.on_demand');
    const classes = wrapper.find('.badge').classes();
    expect(classes).toContain('text-foreground');
    expect(classes).toContain('bg-muted');
    expect(classes.join(' ')).not.toContain('blue');
  });

  it('respects custom threshold', () => {
    const wrapper = mountComponent(StockBadge, {
      props: {
        stock: makeStock({ totalStock: 8, inStock: 8 }),
        threshold: 10,
      },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('product.low_stock');
  });

  it('renders a status the server already derived, without stock figures', () => {
    const wrapper = mountComponent(StockBadge, {
      props: { status: 'backorder' },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('product.backorder');
    expect(wrapper.find('.badge').classes()).toContain('text-info');
  });

  it('hides a derived status from a buyer who may not see stock', () => {
    setFeatures({ stockStatus: { enabled: false } });
    const wrapper = mountComponent(StockBadge, {
      props: { status: 'in-stock' },
      global: { stubs },
    });
    expect(wrapper.text()).toBe('');
  });

  it('renders nothing when stock is undefined', () => {
    const wrapper = mountComponent(StockBadge, {
      props: { stock: undefined },
      global: { stubs },
    });
    expect(wrapper.text()).toBe('');
  });

  // One test per configured value of `stockStatus`, each writing the value
  // itself rather than a decision derived from it. Registered in
  // tests/unit/config-coverage/map.ts, which requires the key in the title.
  describe('stockStatus', () => {
    function mount() {
      return mountComponent(StockBadge, {
        props: { stock: makeStock() },
        global: { stubs },
      });
    }

    it('shows the stock badge when stockStatus is absent from features', () => {
      setFeatures({});
      expect(mount().text()).toContain('product.in_stock');
    });

    it('shows the stock badge when stockStatus is enabled with no access rule', () => {
      setFeatures({ stockStatus: { enabled: true } });
      expect(mount().text()).toContain('product.in_stock');
    });

    it('hides the stock badge when stockStatus requires authentication and the user is anonymous', () => {
      setFeatures({ stockStatus: { enabled: true, access: 'authenticated' } });
      expect(mount().text()).toBe('');
    });

    it('shows the stock badge when stockStatus requires authentication and the user is signed in', () => {
      setFeatures({ stockStatus: { enabled: true, access: 'authenticated' } });
      useAuthStore().user = SIGNED_IN;
      expect(mount().text()).toContain('product.in_stock');
    });

    // Live tenant shape: the seed ships enabled:false alongside an access
    // rule, a combination the admin cannot produce because it hides the access
    // choice when the feature is off. The enabled flag wins regardless.
    it('hides stock when stockStatus is enabled:false with access defined', () => {
      setFeatures({
        stockStatus: { enabled: false, access: 'authenticated' },
      });
      expect(mount().text()).toBe('');
    });
  });

  // A tenant that lets buyers order without stock sets oversellable on every
  // article, so totalStock alone reads as in stock everywhere. On the
  // `available` basis the label reads totalStock minus oversellable instead.
  // Registered in tests/unit/config-coverage/map.ts.
  describe('stockLevelBasis', () => {
    const OVERSELL = 1000;

    it('keeps reading totalStock when stockLevelBasis is absent', () => {
      const wrapper = mountComponent(StockBadge, {
        props: {
          stock: makeStock({
            inStock: 0,
            oversellable: OVERSELL,
            totalStock: 998,
          }),
        },
        global: { stubs },
      });
      expect(wrapper.text()).toContain('product.in_stock');
    });

    it('labels more than five available as in stock (green) when stockLevelBasis is available', () => {
      setStockLevelBasis('available');
      const wrapper = mountComponent(StockBadge, {
        props: {
          stock: makeStock({
            inStock: 6,
            oversellable: OVERSELL,
            totalStock: OVERSELL + 6,
          }),
        },
        global: { stubs },
      });
      expect(wrapper.text()).toContain('product.in_stock');
      expect(wrapper.find('.badge').classes()).toContain('text-success');
    });

    it('labels one to five available as few left (yellow) when stockLevelBasis is available', () => {
      setStockLevelBasis('available');
      for (const remaining of [1, 5]) {
        const wrapper = mountComponent(StockBadge, {
          props: {
            stock: makeStock({
              inStock: remaining,
              oversellable: OVERSELL,
              totalStock: OVERSELL + remaining,
            }),
          },
          global: { stubs },
        });
        expect(wrapper.text()).toContain('product.low_stock');
        expect(wrapper.find('.badge').classes()).toContain('text-warning');
      }
    });

    it('labels zero or less available as a backorder (blue) when stockLevelBasis is available', () => {
      setStockLevelBasis('available');
      // Physical 0 with two undelivered orders already drawn from totalStock.
      for (const totalStock of [OVERSELL, OVERSELL - 2]) {
        const wrapper = mountComponent(StockBadge, {
          props: {
            stock: makeStock({
              inStock: 0,
              oversellable: OVERSELL,
              totalStock,
            }),
          },
          global: { stubs },
        });
        expect(wrapper.text()).toContain('product.backorder');
        const classes = wrapper.find('.badge').classes();
        expect(classes).toContain('text-info');
        expect(classes).not.toContain('bg-muted');
      }
    });

    it('never renders a stock quantity when stockLevelBasis is available', () => {
      setStockLevelBasis('available');
      const wrapper = mountComponent(StockBadge, {
        props: {
          stock: makeStock({
            inStock: 3,
            oversellable: OVERSELL,
            totalStock: OVERSELL + 3,
          }),
          size: 'sm',
        },
        global: { stubs },
      });
      expect(wrapper.text()).not.toMatch(/\d/);
    });
  });
});

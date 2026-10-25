import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  assert,
} from 'vitest';
import { ref, reactive, defineComponent, h, Suspense } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { mountComponent, type MountOptionsFor } from '../../utils/component';
import ProductDetails from '../../../app/components/pages/ProductDetails.vue';
import ProductTopArea from '../../../app/components/product/ProductTopArea.vue';
import type { DetailProduct } from '../../../shared/types/commerce';
import { mockIsCatalogMode } from '../../setup-components';
import { useTenant } from '../../../app/composables/useTenant';

// The product arrives as a prop from the page — ProductDetails makes no
// request for it. Setup is still async (the related, sibling and CMS fetches
// run in it), so mount inside a Suspense boundary, full depth with the stubs
// below, and flush the microtask queue before asserting.
async function mountProductDetails(
  props: { product: DetailProduct; alias: string },
  mountOptions: MountOptionsFor<Component> = {},
) {
  // The wrapper closes over `props` instead of redeclaring them through
  // `Object.keys`, so they are checked against ProductDetails's own props.
  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(Suspense, null, {
          default: () => h(ProductDetails, props),
        });
    },
  });
  const wrapper = mountComponent(Wrapper, mountOptions);
  await flushPromises();
  return wrapper;
}

// useTenant mock is provided by setup-components.ts

// navigateTo is still asserted here: the variant selector navigates to the
// picked sibling's URL. The canonical 301 and the content-miss recovery moved
// to the page with the fetch, and so did their cases.
const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn<typeof navigateTo>(() => Promise.resolve()),
}));

vi.stubGlobal('navigateTo', navigateToMock);

const mockCanAccess = vi.fn<(featureName: string) => boolean>(() => true);

vi.mock('../../../app/composables/useFeatureAccess', () => ({
  useFeatureAccess: () => ({ canAccess: mockCanAccess }),
}));

const { mockAddItem } = vi.hoisted(() => ({ mockAddItem: vi.fn() }));

vi.mock('~/stores/cart', () => ({
  useCartStore: () => ({
    addItem: mockAddItem,
    isLoading: false,
  }),
}));

// The product is a prop now. What is left to control here are the fetches
// ProductDetails still owns: the sibling products, the CMS area, and the
// related row. Anything asking for a product by alias is a regression — the
// page owns that call — and the last case in this file watches for it.

// CMS areas keyed by the areaName the tenant config names for the PDP slot.
// The mock took no arguments and answered every URL with the product, so the
// CMS fetch got the product back and no area could ever render.
const mockCmsAreas = new Map<string, { containers: unknown[] }>();

type AreaQuery = { areaName?: string };

function resolveAreaQuery(
  options?: Record<string, unknown>,
): AreaQuery | undefined {
  const raw = options?.query;
  if (raw != null && typeof raw === 'object' && 'value' in raw) {
    return (raw as { value: AreaQuery }).value;
  }
  return raw as AreaQuery | undefined;
}

// Sibling-variant products, as /api/products/by-ids answers them. Without a
// branch of its own the mock returned the product for this URL too, so
// `products` was always undefined and the variant price map stayed empty.
const mockSiblingProducts = ref<{ products: unknown[] } | null>(null);

const mockUseFetch = vi.fn(
  (urlOrFn?: unknown, options?: Record<string, unknown>) => {
    const url = typeof urlOrFn === 'function' ? urlOrFn() : urlOrFn;
    if (typeof url === 'string' && url.includes('/api/products/by-ids')) {
      return {
        data: mockSiblingProducts,
        error: ref(null),
        status: ref('success'),
        pending: ref(false),
        refresh: vi.fn(),
        execute: vi.fn(),
      };
    }
    if (typeof url === 'string' && url.includes('/api/cms/area')) {
      const areaName = resolveAreaQuery(options)?.areaName;
      return {
        data: ref(
          areaName !== undefined ? (mockCmsAreas.get(areaName) ?? null) : null,
        ),
        error: ref(null),
        status: ref('success'),
        pending: ref(false),
        refresh: vi.fn(),
        execute: vi.fn(),
      };
    }
    return {
      data: ref(null),
      error: ref(null),
      status: ref('success'),
      pending: ref(false),
      refresh: vi.fn(),
      execute: vi.fn(),
    };
  },
);

vi.mock('#app/composables/fetch', () => ({
  useFetch: (...args: Parameters<typeof mockUseFetch>) => mockUseFetch(...args),
}));

vi.stubGlobal('useFetch', mockUseFetch);

// useLocaleAlternates auto-imports useRouter/useRoute from #app/composables/router
// (not the global stub) and registers an afterEach hook on the client; without an
// afterEach the composable throws and aborts the component setup. Override the
// module mock so the router carries afterEach and the route path is mutable per
// test (setRoutePath drives it below).
const { pdpRoute } = vi.hoisted(() => ({
  pdpRoute: {
    path: '/',
    params: {},
    query: {},
    hash: '',
    fullPath: '/',
    name: 'slug',
  },
}));
vi.mock('#app/composables/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    afterEach: vi.fn(),
  }),
  useRoute: () => pdpRoute,
  navigateTo: (...args: Parameters<typeof navigateToMock>) =>
    navigateToMock(...args),
}));

// useState (used by useLocaleAlternates) needs a live Nuxt instance the
// component tier does not provide; back it with a plain ref store.
const { stubUseState } = vi.hoisted(() => ({
  // A plain { value } box is enough; useLocaleAlternates only reads/writes
  // `.value`. Avoids needing Vue's ref inside the hoisted (pre-import) factory.
  stubUseState: (_key: string, init?: () => unknown) => ({
    value: typeof init === 'function' ? init() : undefined,
  }),
}));
vi.stubGlobal('useState', stubUseState);
vi.mock('#app/composables/state', () => ({ useState: stubUseState }));

// Override the global useLocaleMarket mock so localePath prepends the
// /se/sv prefix used by the live-verified canonical fixtures below. The
// real localePath re-adds the current /{market}/{locale}/ prefix to the
// locale-free path returned by the route helpers.
vi.mock('../../../app/composables/useLocaleMarket', () => ({
  useLocaleMarket: () => ({
    currentMarket: { value: 'se' },
    currentLocale: { value: 'sv' },
    localePath: (path: string) =>
      `/se/sv${path.startsWith('/') ? path : '/' + path}`,
    localeQuery: { value: {} },
    getCleanPath: () => '/',
    switchLocale: vi.fn(),
    switchMarket: vi.fn(),
  }),
}));

// Mock SEO/head composables
vi.mock('#app/composables/head', () => ({
  useHead: vi.fn(),
  useHeadSafe: vi.fn(),
  useServerHead: vi.fn(),
  useServerHeadSafe: vi.fn(),
  useSeoMeta: vi.fn(),
  useServerSeoMeta: vi.fn(),
  injectHead: vi.fn(),
}));

vi.stubGlobal('useHead', vi.fn());
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('useSchemaOrg', vi.fn());
vi.stubGlobal(
  'defineProduct',
  vi.fn(() => ({})),
);
// One shared spy so a breadcrumb assertion reads the same call whichever
// resolution path the component takes for this auto-import.
const { defineBreadcrumbMock } = vi.hoisted(() => ({
  defineBreadcrumbMock: vi.fn(
    (_input: {
      itemListElement: () => Array<{ name: string; item?: string }>;
    }) => ({}),
  ),
}));
vi.stubGlobal('defineBreadcrumb', defineBreadcrumbMock);

// Mock @unhead/schema-org/vue helpers (auto-imported by Nuxt)
vi.mock('@unhead/schema-org/vue', () => ({
  defineProduct: vi.fn(() => ({})),
  defineBreadcrumb: defineBreadcrumbMock,
}));

// Mock nuxt-schema-org runtime composable (auto-imported by Nuxt unimport).
// Resolve the path dynamically so the mock isn't tied to a specific pnpm store hash.
const { schemaOrgComposablePath } = vi.hoisted(() => {
  const nodeModule = require.resolve('nuxt-schema-org/schema'); // exported subpath
  const pkgRoot = nodeModule.replace(/\/dist\/schema\..*$/, '');
  return {
    schemaOrgComposablePath: `${pkgRoot}/dist/runtime/app/composables/useSchemaOrg`,
  };
});
vi.mock(schemaOrgComposablePath, () => ({
  useSchemaOrg: vi.fn(),
}));

function makeProduct(overrides: Record<string, unknown> = {}): DetailProduct {
  return {
    productId: 1,
    name: 'Test Product',
    alias: 'test-product',
    articleNumber: 'ART-001',
    canonicalUrl: '/products/test-product',
    brand: { name: 'Test Brand' },
    unitPrice: {
      sellingPriceIncVat: 199,
      sellingPriceIncVatFormatted: '199,00 kr',
      isDiscounted: false,
    },
    totalStock: { inStock: 10, oversellable: 0, totalStock: 10, static: 0 },
    productImages: [{ fileName: 'product.jpg', isPrimary: true, url: '' }],
    skus: [{ skuId: 101, name: 'Default', stock: { totalStock: 10 } }],
    texts: { text1: 'Description', text2: 'Short description' },
    discountCampaigns: [],
    discountType: 'NONE',
    ...overrides,
  } as unknown as DetailProduct;
}

const defaultStubs = {
  Icon: {
    template: '<span class="icon" :data-name="name" />',
    props: ['name'],
  },
  NuxtIcon: {
    template: '<span class="icon" :data-name="name" />',
    props: ['name'],
  },
  ProductGallery: true,
  ProductDetailsSkeleton: {
    template: '<div data-testid="pdp-loading" />',
  },
  EmptyState: {
    template: '<div data-testid="pdp-error" />',
    props: ['icon', 'title', 'description', 'actionLabel', 'actionTo'],
  },
  AppBreadcrumbs: true,
  ErrorBoundary: {
    template: '<div><slot /></div>',
    props: ['section'],
  },
  SharedErrorBoundary: {
    template: '<div><slot /></div>',
    props: ['section'],
  },
  ProductTabs: true,
  ProductVariantSelector: true,
  ProductRelatedProducts: true,
  PriceDisplay: {
    template: '<span class="price-display" />',
    props: ['price', 'lowestPrice', 'discountType', 'campaignNames'],
  },
  SharedPriceDisplay: {
    template: '<span class="price-display" />',
    props: ['price', 'lowestPrice', 'discountType', 'campaignNames'],
  },
  PriceSlot: {
    template:
      '<span class="price-slot" :data-mode="mode"><span v-if="mode === \'list\' || mode === \'contract\'" class="price-display" /><span v-else-if="mode === \'hidden\'" class="price-login" /></span>',
    props: [
      'mode',
      'price',
      'returnTo',
      'lowestPrice',
      'discountType',
      'campaignNames',
    ],
  },
  SharedPriceSlot: {
    template:
      '<span class="price-slot" :data-mode="mode"><span v-if="mode === \'list\' || mode === \'contract\'" class="price-display" /><span v-else-if="mode === \'hidden\'" class="price-login" /></span>',
    props: [
      'mode',
      'price',
      'returnTo',
      'lowestPrice',
      'discountType',
      'campaignNames',
    ],
  },
  StockBadge: {
    template: '<span class="stock-badge" />',
    props: ['stock'],
  },
  SharedStockBadge: {
    template: '<span class="stock-badge" />',
    props: ['stock'],
  },
  QuantityInput: {
    template: '<div class="quantity-input" />',
    props: ['modelValue', 'min', 'max'],
  },
  SharedQuantityInput: {
    template: '<div class="quantity-input" />',
    props: ['modelValue', 'min', 'max'],
  },
  GeinsImage: true,
  SharedGeinsImage: true,
};

describe('ProductDetails', () => {
  beforeEach(() => {
    mockCanAccess.mockReturnValue(true);
    mockUseFetch.mockClear();
    navigateToMock.mockClear();
    mockCmsAreas.clear();
    mockSiblingProducts.value = null;
  });

  /**
   * The PDP resolves `CMS_SLOTS.PRODUCT_DETAIL` against the tenant config and
   * fetches the area that slot names. The spec mounted the component but never
   * configured the key, so no area rendered either way.
   *
   * `useCmsSlot` stays unmocked and the fetch stub answers on the areaName the
   * config produced, so pointing the slot elsewhere turns the first case red.
   */
  describe('cms zone on the product detail page', () => {
    const PDP_AREA = 'PDP Extra';

    const cmsStubs = {
      ...defaultStubs,
      CmsWidgetArea: {
        template: '<div class="cms-area" />',
        props: ['containers'],
      },
    };

    const originalCms = useTenant().tenant.value?.cms;

    function configurePdpSlot(areaName: string) {
      const { tenant } = useTenant();
      const current = tenant.value;
      assert.isDefined(current);
      tenant.value = {
        ...current,
        cms: { slots: { product_detail: { family: 'Product', areaName } } },
      };
    }

    afterEach(() => {
      // The setup fixture is shared across this file, so put `cms` back rather
      // than leaving later tests to run on whatever the last case configured.
      const { tenant } = useTenant();
      const current = tenant.value;
      assert.isDefined(current);
      tenant.value = { ...current, cms: originalCms };
    });

    it('renders the pdp zone for the area product_detail names', async () => {
      const product = makeProduct();
      configurePdpSlot(PDP_AREA);
      mockCmsAreas.set(PDP_AREA, { containers: [{ id: 'pdp' }] });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: cmsStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-cms-area"]').exists()).toBe(true);
    });

    it('renders no pdp zone when product_detail names another area', async () => {
      const product = makeProduct();
      configurePdpSlot('Somewhere Else');
      mockCmsAreas.set(PDP_AREA, { containers: [{ id: 'pdp' }] });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: cmsStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-cms-area"]').exists()).toBe(false);
    });
  });

  describe('purchase actions per mode and access', () => {
    // canPurchase is `canAccess('orderPlacement') && !isCatalogMode`. Each half
    // is asserted alone, so neither can start carrying the other.
    afterEach(() => {
      mockIsCatalogMode.value = false;
    });

    it('renders the add-to-cart action in commerce mode with orderPlacement access', async () => {
      const product = makeProduct();

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-actions"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="add-to-cart-button"]').exists()).toBe(
        true,
      );
    });

    it('hides the add-to-cart action when mode is catalog', async () => {
      mockIsCatalogMode.value = true;
      const product = makeProduct();

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-actions"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="add-to-cart-button"]').exists()).toBe(
        false,
      );
    });

    it('hides the add-to-cart action when orderPlacement access is denied', async () => {
      mockCanAccess.mockImplementation(
        (name: string) => name !== 'orderPlacement',
      );
      const product = makeProduct();

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-actions"]').exists()).toBe(false);
    });
  });

  describe('breadcrumbs', () => {
    const crumbs = async (overrides: Record<string, unknown>) => {
      const product = makeProduct(overrides);
      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );
      return wrapper
        .findComponent({ name: 'AppBreadcrumbs' })
        .props('items') as Array<{ label: string; href?: string }>;
    };

    it('renders the full trail: Home, ancestors, primary category, product', async () => {
      const items = await crumbs({
        name: 'Insexskruv',
        canonicalUrl: '/se/sv/p/fastelement/testkategori/insexskruv',
        ancestors: [
          { name: 'Fästelement', canonicalUrl: '/se/sv/c/fastelement' },
        ],
        primaryCategory: {
          name: 'Testkategori',
          alias: 'testkategori',
          canonicalUrl: '/se/sv/c/fastelement/testkategori',
        },
      });

      expect(items.map((i) => i.label)).toEqual([
        'common.home',
        'Fästelement',
        'Testkategori',
        'Insexskruv',
      ]);
    });

    it('links the category crumb to its canonical, not the 301-ing short alias', async () => {
      // `/se/sv/c/testkategori` — what categoryPath('/' + alias) produced —
      // answers 301 to the nested canonical on every nested category.
      const items = await crumbs({
        ancestors: [
          { name: 'Fästelement', canonicalUrl: '/se/sv/c/fastelement' },
        ],
        primaryCategory: {
          name: 'Testkategori',
          alias: 'testkategori',
          canonicalUrl: '/se/sv/c/fastelement/testkategori',
        },
      });

      expect(items.find((i) => i.label === 'Testkategori')?.href).toBe(
        '/se/sv/c/fastelement/testkategori',
      );
      expect(items.find((i) => i.label === 'Fästelement')?.href).toBe(
        '/se/sv/c/fastelement',
      );
    });

    it('normalizes the prefix-less canonical shape other tenants return', async () => {
      const items = await crumbs({
        ancestors: [
          {
            name: 'Säkerhet och övrigt',
            canonicalUrl: '/se/sv/sakerhet-och-ovrigt',
          },
        ],
        primaryCategory: {
          name: 'Skyddsutrustning',
          alias: 'skyddsutrustning',
          canonicalUrl: '/se/sv/sakerhet-och-ovrigt/skyddsutrustning',
        },
      });

      expect(items.map((i) => i.href)).toEqual([
        '/se/sv/',
        '/se/sv/c/sakerhet-och-ovrigt',
        '/se/sv/c/sakerhet-och-ovrigt/skyddsutrustning',
        undefined,
      ]);
    });

    it('falls back to the short trail when no ancestors were resolved', async () => {
      // An unresolvable chain arrives as [], never partially, so the page
      // renders what it can prove rather than a trail with a gap.
      const items = await crumbs({
        name: 'Insexskruv',
        ancestors: [],
        primaryCategory: {
          name: 'Testkategori',
          alias: 'testkategori',
          canonicalUrl: '/se/sv/c/fastelement/testkategori',
        },
      });

      expect(items.map((i) => i.label)).toEqual([
        'common.home',
        'Testkategori',
        'Insexskruv',
      ]);
    });

    it('feeds the same items to the JSON-LD BreadcrumbList', async () => {
      // The structured data maps over this array, so a truncated trail would
      // reach crawlers too. Asserting the items is asserting both.
      const items = await crumbs({
        name: 'Insexskruv',
        ancestors: [
          { name: 'Fästelement', canonicalUrl: '/se/sv/c/fastelement' },
        ],
        primaryCategory: {
          name: 'Testkategori',
          alias: 'testkategori',
          canonicalUrl: '/se/sv/c/fastelement/testkategori',
        },
      });

      const lastCall = defineBreadcrumbMock.mock.calls.at(-1);
      assert(lastCall, 'defineBreadcrumb was never called');
      const breadcrumbArg = lastCall[0].itemListElement();

      expect(breadcrumbArg.map((e) => e.name)).toEqual([
        'common.home',
        'Fästelement',
        'Testkategori',
        'Insexskruv',
      ]);
      // ...and stays in step with what the page renders.
      expect(breadcrumbArg.map((e) => e.name)).toEqual(
        items.map((i) => i.label),
      );
      expect(breadcrumbArg.map((e) => e.item)).toEqual(
        items.map((i) => i.href),
      );
    });
  });

  describe('migrated entity-URL hrefs', () => {
    it('builds the breadcrumb category href via categoryPath', async () => {
      const product = makeProduct({
        canonicalUrl: '/se/sv/test-product',
        primaryCategory: { name: 'Material', alias: 'material' },
      });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      const breadcrumbs = wrapper.findComponent({ name: 'AppBreadcrumbs' });
      const items = breadcrumbs.props('items') as Array<{
        label: string;
        href?: string;
      }>;
      // categoryPath('/material') -> '/c/material', localePath -> '/se/sv/c/material'
      // Find the specific category breadcrumb by its label so a wrong href on an
      // unrelated item cannot make the assertion pass.
      const categoryItem = items.find((i) => i.label === 'Material');
      expect(categoryItem).toBeDefined();
      expect(categoryItem?.href).toBe('/se/sv/c/material');
    });

    it('navigates to the productPath-built variant URL on variant change', async () => {
      const product = makeProduct({
        alias: 'grenror-150-150-88',
        canonicalUrl: '/se/sv/p/grenror-150-150-88',
        variantDimensions: [{ dimension: 'Variant', value: '88' }],
        variantGroup: {
          variants: [
            { alias: 'grenror-150-150-88', dimension: 'Variant', value: '88' },
            { alias: 'grenror-150-150-90', dimension: 'Variant', value: '90' },
          ],
        },
      });
      // Route params drive the variant nav path segments.
      pdpRoute.params = {
        alias: ['material', 'grenror', 'grenror-150-150-88'],
      };

      const Selector = defineComponent({
        props: ['modelValue', 'variantDimensions', 'variants'],
        emits: ['update:modelValue'],
        setup(_p, { emit }) {
          // Simulate the user picking the 90 variant after mount.
          return () =>
            h('button', {
              'data-testid': 'pick-variant',
              onClick: () => emit('update:modelValue', { Variant: '90' }),
            });
        },
      });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        {
          global: { stubs: { ...defaultStubs, VariantSelector: Selector } },
        },
      );

      navigateToMock.mockClear();
      await wrapper.find('[data-testid="pick-variant"]').trigger('click');
      await flushPromises();

      // productPath('/material/grenror/grenror-150-150-90') ->
      // '/p/material/grenror/grenror-150-150-90', localePath -> '/se/sv/p/...'
      expect(navigateToMock).toHaveBeenCalledWith(
        '/se/sv/p/material/grenror/grenror-150-150-90',
      );
      pdpRoute.params = {};
    });
  });

  describe('campaign badges', () => {
    it('shows campaign badges when product has visible campaigns', async () => {
      const product = makeProduct({
        discountCampaigns: [{ name: 'Spring Sale', hideTitle: false }],
      });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      const badges = wrapper.find('[data-testid="pdp-campaign-badges"]');
      expect(badges.exists()).toBe(true);
      expect(badges.text()).toContain('Spring Sale');
    });

    it('hides campaign badges when all campaigns have hideTitle true', async () => {
      const product = makeProduct({
        discountCampaigns: [{ name: 'Hidden', hideTitle: true }],
      });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-campaign-badges"]').exists()).toBe(
        false,
      );
    });

    it('shows no badges when discountCampaigns is empty', async () => {
      const product = makeProduct({ discountCampaigns: [] });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(wrapper.find('[data-testid="pdp-campaign-badges"]').exists()).toBe(
        false,
      );
    });
  });

  describe('negotiated price banner', () => {
    it('shows info banner when discountType is EXTERNAL', async () => {
      const product = makeProduct({
        discountType: 'EXTERNAL',
        unitPrice: {
          sellingPriceIncVat: 150,
          sellingPriceIncVatFormatted: '150,00 kr',
          isDiscounted: true,
        },
      });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      const banner = wrapper.find('[data-testid="negotiated-price-banner"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain('discount.negotiated_price_info');
    });

    it('does not show banner for SALE_PRICE', async () => {
      const product = makeProduct({ discountType: 'SALE_PRICE' });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(
        wrapper.find('[data-testid="negotiated-price-banner"]').exists(),
      ).toBe(false);
    });

    it('does not show banner for NONE', async () => {
      const product = makeProduct({ discountType: 'NONE' });

      const wrapper = await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      expect(
        wrapper.find('[data-testid="negotiated-price-banner"]').exists(),
      ).toBe(false);
    });
  });

  // The variant sheet renders one price per row, and the row must answer to the
  // inc/ex VAT switcher. The parent owns half of that: it resolves each sibling
  // product and hands the row its price. Passing a single pre-picked string here
  // makes the preference unreachable inside the selector, whatever the selector
  // does with it.
  describe('variant price data handed to the selector', () => {
    function captureProps(sink: { value: Record<string, unknown> }) {
      return defineComponent({
        props: [
          'modelValue',
          'variantDimensions',
          'variants',
          'variantProducts',
          'priceIncVatFormatted',
          'priceExVatFormatted',
        ],
        setup(p) {
          return () => {
            sink.value = { ...p };
            return h('div', { 'data-testid': 'variant-selector-stub' });
          };
        },
      });
    }

    it('passes both VAT variants of each sibling price, not one pre-picked string', async () => {
      const sink = { value: {} as Record<string, unknown> };
      const product = makeProduct({
        alias: 'grenror-150-150-88',
        variantDimensions: [{ dimension: 'Variant', value: '88' }],
        variantGroup: {
          variants: [
            { alias: 'grenror-150-150-88', dimension: 'Variant', value: '88' },
            { alias: 'grenror-150-150-90', dimension: 'Variant', value: '90' },
          ],
        },
      });
      mockSiblingProducts.value = {
        products: [
          {
            productId: 2,
            alias: 'grenror-150-150-90',
            name: 'Grenrör 150/150-90',
            articleNumber: 'S1-233-090',
            unitPrice: {
              sellingPriceIncVatFormatted: '950 kr',
              sellingPriceExVatFormatted: '760 kr',
            },
          },
        ],
      };

      await mountProductDetails(
        { product, alias: product.alias },
        {
          global: {
            stubs: { ...defaultStubs, VariantSelector: captureProps(sink) },
          },
        },
      );

      expect(sink.value.variantProducts).toMatchObject({
        'grenror-150-150-90': {
          priceIncVatFormatted: '950 kr',
          priceExVatFormatted: '760 kr',
        },
      });
    });

    it('passes both VAT variants of the parent fallback price', async () => {
      const sink = { value: {} as Record<string, unknown> };
      const product = makeProduct({
        alias: 'grenror-150-150-88',
        variantDimensions: [{ dimension: 'Variant', value: '88' }],
        variantGroup: {
          variants: [
            { alias: 'grenror-150-150-88', dimension: 'Variant', value: '88' },
            { alias: 'grenror-150-150-90', dimension: 'Variant', value: '90' },
          ],
        },
        unitPrice: {
          sellingPriceIncVat: 1200,
          sellingPriceIncVatFormatted: '1 200 kr',
          sellingPriceExVatFormatted: '960 kr',
          isDiscounted: false,
        },
      });

      await mountProductDetails(
        { product, alias: product.alias },
        {
          global: {
            stubs: { ...defaultStubs, VariantSelector: captureProps(sink) },
          },
        },
      );

      expect(sink.value.priceIncVatFormatted).toBe('1 200 kr');
      expect(sink.value.priceExVatFormatted).toBe('960 kr');
    });
  });

  describe('current variant seeding', () => {
    // Capture the modelValue the variant selector receives. Reads it in the
    // render fn so the latest value (after the immediate seed watch) wins.
    // The template tag is <VariantSelector>, so that is the stub key.
    function captureSelector(sink: { value: Record<string, string> }) {
      return defineComponent({
        props: ['modelValue', 'variantDimensions', 'variants'],
        setup(p) {
          return () => {
            sink.value = {
              ...((p.modelValue as Record<string, string>) ?? {}),
            };
            return h('div', { 'data-testid': 'variant-selector-stub' });
          };
        },
      });
    }

    function stubsWith(sink: { value: Record<string, string> }) {
      return { ...defaultStubs, VariantSelector: captureSelector(sink) };
    }

    it('seeds the selector with the active sibling variant', async () => {
      const sink = { value: {} as Record<string, string> };
      const product = makeProduct({
        alias: 'grenror-150-150-88',
        variantDimensions: [{ dimension: 'Variant', value: '88' }],
        variantGroup: {
          variants: [
            { alias: 'grenror-150-150-88', dimension: 'Variant', value: '88' },
            { alias: 'grenror-150-150-90', dimension: 'Variant', value: '90' },
          ],
        },
      });

      await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: stubsWith(sink) } },
      );

      expect(sink.value).toEqual({ Variant: '88' });
    });

    it('falls back to the variant label when value is absent', async () => {
      const sink = { value: {} as Record<string, string> };
      const product = makeProduct({
        alias: 'grenror-150-150-88',
        variantDimensions: [{ dimension: 'Variant', value: '88' }],
        variantGroup: {
          variants: [
            { alias: 'grenror-150-150-88', dimension: 'Variant', label: '88' },
            { alias: 'grenror-150-150-90', dimension: 'Variant', label: '90' },
          ],
        },
      });

      await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: stubsWith(sink) } },
      );

      expect(sink.value).toEqual({ Variant: '88' });
    });

    it('leaves the selection empty when no variant alias matches the product', async () => {
      const sink = { value: { seeded: 'no' } as Record<string, string> };
      const product = makeProduct({
        alias: 'parent-product',
        variantDimensions: [{ dimension: 'Variant', value: 'A' }],
        variantGroup: {
          variants: [
            { alias: 'child-a', dimension: 'Variant', value: 'A' },
            { alias: 'child-b', dimension: 'Variant', value: 'B' },
          ],
        },
      });

      await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: stubsWith(sink) } },
      );

      expect(sink.value).toEqual({});
    });
  });

  // A product sold in several SKUs of its own, as the API sends it: one
  // `DefaultProduct` dimension row and node, the choice only in `skus`.
  describe('a product sold in several SKUs', () => {
    const stock = (totalStock: number) => ({
      inStock: totalStock,
      oversellable: 0,
      totalStock,
      static: 0,
    });
    const product = makeProduct({
      productId: 1099,
      alias: 'skyddsglasogon-klar-en-166',
      name: 'Skyddsglasögon klar EN 166',
      articleNumber: 'SKY-GLAS-KLAR',
      totalStock: stock(289),
      skus: [
        {
          skuId: 1099,
          name: 'Skyddsglasögon klar',
          articleNumber: 'SKY-GLAS-KLAR',
          stock: stock(284),
        },
        {
          skuId: 1113,
          name: 'S',
          articleNumber: 'SKY-GLAS-KLAR-S',
          stock: stock(5),
        },
        {
          skuId: 1114,
          name: 'M',
          articleNumber: 'SKY-GLAS-KLAR-M',
          stock: stock(0),
        },
      ],
      variantDimensions: [
        {
          dimension: 'DefaultProduct',
          value: 'skyddsglasögon klar en 166',
          label: 'Skyddsglasögon klar EN 166',
        },
      ],
      variantGroup: {
        variants: [
          {
            alias: 'skyddsglasogon-klar-en-166',
            dimension: 'DefaultProduct',
            value: 'skyddsglasögon klar en 166',
            skuId: 0,
          },
        ],
      },
    });

    const openSkuSheet = vi.fn();
    const received = { skuOptions: [] as { skuId: number }[] };

    const Selector = defineComponent({
      props: ['modelValue', 'skuOptions', 'skuId'],
      emits: ['update:modelValue', 'update:skuId'],
      setup(p, { emit, expose }) {
        expose({ openSkuSheet });
        return () => {
          received.skuOptions = (p.skuOptions as { skuId: number }[]) ?? [];
          return h(
            'div',
            { 'data-testid': 'sku-selector-stub' },
            [1113, 1114].map((skuId) =>
              h('button', {
                'data-testid': `pick-${skuId}`,
                onClick: () => emit('update:skuId', skuId),
              }),
            ),
          );
        };
      },
    });

    const stubs = {
      ...defaultStubs,
      VariantSelector: Selector,
      StockBadge: {
        template:
          '<span class="stock-badge" :data-total="stock?.totalStock" />',
        props: ['stock'],
      },
      QuantityInput: {
        template:
          '<div class="quantity-input" :data-max="max"><button data-testid="set-quantity-20" @click="$emit(\'update:modelValue\', 20)" /></div>',
        props: ['modelValue', 'min', 'max'],
        emits: ['update:modelValue'],
      },
    };

    async function mountSkuProduct(p: DetailProduct = product) {
      return mountProductDetails(
        { product: p, alias: p.alias },
        { global: { stubs } },
      );
    }

    async function pick(
      wrapper: Awaited<ReturnType<typeof mountSkuProduct>>,
      skuId: number,
    ) {
      await wrapper.find(`[data-testid="pick-${skuId}"]`).trigger('click');
      await flushPromises();
    }

    const addButton = (wrapper: Awaited<ReturnType<typeof mountSkuProduct>>) =>
      wrapper.find('[data-testid="add-to-cart-button"]');

    beforeEach(() => {
      mockAddItem.mockClear();
      openSkuSheet.mockClear();
      received.skuOptions = [];
    });

    it('hands every SKU to the selector', async () => {
      await mountSkuProduct();

      expect(received.skuOptions.map((s) => s.skuId)).toEqual([
        1099, 1113, 1114,
      ]);
    });

    it('asks for a pick instead of adding before one is made', async () => {
      const wrapper = await mountSkuProduct();

      expect(addButton(wrapper).text()).toBe('product.choose_variant');
      await addButton(wrapper).trigger('click');

      expect(openSkuSheet).toHaveBeenCalledOnce();
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it('adds the picked SKU, not the first one', async () => {
      const wrapper = await mountSkuProduct();
      await pick(wrapper, 1113);

      expect(addButton(wrapper).text()).toBe('product.add_to_cart');
      await addButton(wrapper).trigger('click');

      expect(mockAddItem).toHaveBeenCalledWith(1113, 1);
      expect(openSkuSheet).not.toHaveBeenCalled();
    });

    it('shows the product stock before a pick and the picked SKU stock after', async () => {
      const wrapper = await mountSkuProduct();
      const badge = () => wrapper.find('.stock-badge').attributes('data-total');

      expect(badge()).toBe('289');
      await pick(wrapper, 1113);
      expect(badge()).toBe('5');
    });

    it('caps the quantity at the picked SKU stock', async () => {
      const wrapper = await mountSkuProduct();
      await pick(wrapper, 1113);

      expect(wrapper.find('.quantity-input').attributes('data-max')).toBe('5');
    });

    it('lowers a quantity set before the pick to the picked SKU stock', async () => {
      const wrapper = await mountSkuProduct();
      await wrapper.find('[data-testid="set-quantity-20"]').trigger('click');
      await pick(wrapper, 1113);

      await addButton(wrapper).trigger('click');

      expect(mockAddItem).toHaveBeenCalledWith(1113, 5);
    });

    it('shows the out-of-stock block for a picked SKU without stock', async () => {
      const wrapper = await mountSkuProduct();
      await pick(wrapper, 1114);

      expect(wrapper.find('[data-testid="oos-block"]').exists()).toBe(true);
      expect(addButton(wrapper).exists()).toBe(false);
      // The picker stays, so another SKU can still be chosen.
      expect(wrapper.find('[data-testid="sku-selector-stub"]').exists()).toBe(
        true,
      );
    });

    it('hands the picked SKU article number to the top area', async () => {
      const wrapper = await mountSkuProduct();
      const artNr = () =>
        wrapper.findComponent(ProductTopArea).props('articleNumber');

      expect(artNr()).toBeUndefined();
      await pick(wrapper, 1113);
      expect(artNr()).toBe('SKY-GLAS-KLAR-S');
    });

    it('leaves a single-SKU product on its own article number', async () => {
      const wrapper = await mountSkuProduct(
        makeProduct({
          skus: [{ skuId: 101, articleNumber: 'SKU-OWN', stock: stock(10) }],
        }),
      );

      expect(
        wrapper.findComponent(ProductTopArea).props('articleNumber'),
      ).toBeUndefined();
    });

    it('renders no selector for a single-SKU product with only its own DefaultProduct row', async () => {
      const wrapper = await mountSkuProduct(
        makeProduct({
          variantDimensions: product.variantDimensions,
          variantGroup: product.variantGroup,
        }),
      );

      expect(wrapper.find('[data-testid="sku-selector-stub"]').exists()).toBe(
        false,
      );
      expect(addButton(wrapper).text()).toBe('product.add_to_cart');
      await addButton(wrapper).trigger('click');
      expect(mockAddItem).toHaveBeenCalledWith(101, 1);
    });
  });

  // Live shape of a product sold in several SKUs that also has sibling
  // products: the sibling dimension sits on the level-1 product nodes, which
  // carry the alias, and the SKUs hang below them as level-0 `DefaultSku`
  // leaves. The SKU pick belongs to the product on screen; a sibling pick
  // leaves this page for the sibling's own, where a new SKU pick is needed.
  describe('a product sold in several SKUs that has sibling products', () => {
    const stock = (totalStock: number) => ({
      inStock: totalStock,
      oversellable: 0,
      totalStock,
      static: 0,
    });
    const skuLeaf = (skuId: number, value: string) => ({
      dimension: 'DefaultSku',
      value,
      level: 0,
      alias: null,
      skuId,
    });
    const variantGroup = {
      variants: [
        {
          dimension: 'Färg',
          value: 'klar',
          label: 'Klar',
          level: 1,
          alias: 'skyddsglasogon-klar',
          productId: 1099,
          variants: [skuLeaf(1113, 's'), skuLeaf(1114, 'm')],
        },
        {
          dimension: 'Färg',
          value: 'tonad',
          label: 'Tonad',
          level: 1,
          alias: 'skyddsglasogon-tonad',
          productId: 1200,
          variants: [skuLeaf(1213, 's'), skuLeaf(1214, 'm')],
        },
      ],
    };
    const clear = makeProduct({
      productId: 1099,
      alias: 'skyddsglasogon-klar',
      canonicalUrl: '/se/sv/p/skyddsglasogon-klar',
      skus: [
        { skuId: 1113, name: 'S', stock: stock(5) },
        { skuId: 1114, name: 'M', stock: stock(7) },
      ],
      variantDimensions: [{ dimension: 'Färg', value: 'klar', level: 1 }],
      variantGroup,
    });
    const tinted = makeProduct({
      productId: 1200,
      alias: 'skyddsglasogon-tonad',
      canonicalUrl: '/se/sv/p/skyddsglasogon-tonad',
      skus: [
        { skuId: 1213, name: 'S', stock: stock(3) },
        { skuId: 1214, name: 'M', stock: stock(4) },
      ],
      variantDimensions: [{ dimension: 'Färg', value: 'tonad', level: 1 }],
      variantGroup,
    });

    const openSkuSheet = vi.fn();
    const Selector = defineComponent({
      props: ['modelValue', 'skuOptions', 'skuId'],
      emits: ['update:modelValue', 'update:skuId'],
      setup(p, { emit, expose }) {
        expose({ openSkuSheet });
        return () =>
          h('div', [
            h('span', { 'data-testid': 'selection' }, [
              JSON.stringify(p.modelValue),
            ]),
            h('span', { 'data-testid': 'sku-id' }, [String(p.skuId)]),
            ...((p.skuOptions as { skuId: number }[]) ?? []).map(({ skuId }) =>
              h('button', {
                'data-testid': `pick-sku-${skuId}`,
                onClick: () => emit('update:skuId', skuId),
              }),
            ),
            ...['klar', 'tonad'].map((value) =>
              h('button', {
                'data-testid': `pick-${value}`,
                onClick: () => emit('update:modelValue', { Färg: value }),
              }),
            ),
          ]);
      },
    });

    const errorHandler = vi.fn();

    async function mountClear() {
      const props = reactive({ product: clear, alias: clear.alias });
      const wrapper = await mountProductDetails(props, {
        global: {
          stubs: { ...defaultStubs, VariantSelector: Selector },
          config: { errorHandler },
        },
      });
      return { wrapper, props };
    }

    async function click(
      wrapper: Awaited<ReturnType<typeof mountClear>>['wrapper'],
      testId: string,
    ) {
      await wrapper.find(`[data-testid="${testId}"]`).trigger('click');
      await flushPromises();
    }

    const addButton = (
      wrapper: Awaited<ReturnType<typeof mountClear>>['wrapper'],
    ) => wrapper.find('[data-testid="add-to-cart-button"]');

    beforeEach(() => {
      mockAddItem.mockClear();
      openSkuSheet.mockClear();
      errorHandler.mockClear();
      pdpRoute.params = { alias: ['skyddsglasogon-klar'] };
    });

    afterEach(() => {
      navigateToMock.mockImplementation(() => Promise.resolve());
      pdpRoute.params = {};
    });

    it("keeps the SKU pick when the product's own variant value is picked", async () => {
      const { wrapper } = await mountClear();
      await click(wrapper, 'pick-sku-1114');
      await click(wrapper, 'pick-klar');

      expect(navigateToMock).not.toHaveBeenCalled();
      await addButton(wrapper).trigger('click');
      expect(mockAddItem).toHaveBeenCalledWith(1114, 1);
    });

    it('adds nothing while a sibling pick is on its way, whatever SKU was picked', async () => {
      navigateToMock.mockImplementation(() => new Promise(() => {}));
      const { wrapper } = await mountClear();
      await click(wrapper, 'pick-sku-1114');
      await click(wrapper, 'pick-tonad');

      expect(navigateToMock).toHaveBeenCalledOnce();
      expect(addButton(wrapper).attributes('disabled')).toBeDefined();
      await addButton(wrapper).trigger('click');
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it("drops the SKU pick once the sibling's page arrives and asks for a new one", async () => {
      navigateToMock.mockImplementation(() => new Promise(() => {}));
      const { wrapper, props } = await mountClear();
      await click(wrapper, 'pick-sku-1114');
      await click(wrapper, 'pick-tonad');

      // Same component, next product: what a sibling switch looks like when
      // the page reuses the instance instead of remounting it.
      props.product = tinted;
      props.alias = tinted.alias;
      await flushPromises();

      expect(wrapper.find('[data-testid="selection"]').text()).toBe(
        JSON.stringify({ Färg: 'tonad' }),
      );
      expect(wrapper.find('[data-testid="sku-id"]').text()).toBe('null');
      expect(addButton(wrapper).text()).toBe('product.choose_variant');
      await addButton(wrapper).trigger('click');
      expect(openSkuSheet).toHaveBeenCalledOnce();
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it('puts the selection back on this product and keeps its SKU when the switch fails', async () => {
      navigateToMock.mockImplementation(() =>
        Promise.resolve({ type: 4 } as never),
      );
      const { wrapper } = await mountClear();
      await click(wrapper, 'pick-sku-1114');
      await click(wrapper, 'pick-tonad');

      expect(wrapper.find('[data-testid="selection"]').text()).toBe(
        JSON.stringify({ Färg: 'klar' }),
      );
      expect(addButton(wrapper).attributes('disabled')).toBeUndefined();
      await addButton(wrapper).trigger('click');
      expect(mockAddItem).toHaveBeenCalledWith(1114, 1);
    });

    it('keeps add to cart off when an earlier switch fails under a newer one', async () => {
      let failFirst!: () => void;
      navigateToMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              failFirst = () => resolve({ type: 8 } as never);
            }),
        )
        .mockImplementationOnce(() => new Promise(() => {}));
      const { wrapper } = await mountClear();
      await click(wrapper, 'pick-sku-1114');
      await click(wrapper, 'pick-tonad');
      await click(wrapper, 'pick-klar');
      await click(wrapper, 'pick-tonad');
      failFirst();
      await flushPromises();

      expect(addButton(wrapper).attributes('disabled')).toBeDefined();
    });
  });

  // The page loads the product and hands it down. If this component ever asks
  // for one again, every PDP pays for two requests — so the mock is watched for
  // a product-by-alias url rather than trusted not to see one.
  describe('the product it is given', () => {
    it('makes no request for the product', async () => {
      const product = makeProduct();

      await mountProductDetails(
        { product, alias: product.alias },
        { global: { stubs: defaultStubs } },
      );

      // The by-ids and related endpoints live under the same prefix, so the
      // check is for this product's own url, not for the prefix.
      const urls = mockUseFetch.mock.calls.map(([urlOrFn]) =>
        typeof urlOrFn === 'function' ? urlOrFn() : urlOrFn,
      );
      expect(urls).not.toContain(`/api/products/${product.alias}`);
    });

    it("builds its own requests from the URL alias, not the product's", async () => {
      // A locale fallback answers the requested address with the
      // default-language product, whose own alias is a different one. Asking
      // under the product's alias would quietly move every follow-up request
      // to the other locale's product.
      const product = makeProduct({ alias: 'wood-screw-sv' });

      await mountProductDetails(
        { product, alias: 'wood-screw-se' },
        { global: { stubs: defaultStubs } },
      );

      const urls = mockUseFetch.mock.calls.map(([urlOrFn]) =>
        typeof urlOrFn === 'function' ? urlOrFn() : urlOrFn,
      );
      expect(urls).toContain('/api/products/wood-screw-se/related');
      expect(urls).not.toContain('/api/products/wood-screw-sv/related');
    });
  });
});

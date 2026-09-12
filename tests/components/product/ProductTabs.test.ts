import { describe, it, expect } from 'vitest';
import { mountComponent } from '../../utils/component';
import ProductTabs from '../../../app/components/product/ProductTabs.vue';
import { makeListProduct } from '../../fixtures/product';

const stubs = {
  Tabs: {
    template:
      '<div class="tabs" data-testid="tabs" :data-default-value="defaultValue"><slot /></div>',
    props: ['defaultValue'],
  },
  TabsList: {
    template: '<div class="tabs-list" data-testid="tabs-list"><slot /></div>',
  },
  TabsTrigger: {
    template:
      '<button class="tabs-trigger" :data-value="value"><slot /></button>',
    props: ['value'],
  },
  TabsContent: {
    template: '<div class="tabs-content" :data-value="value"><slot /></div>',
    props: ['value'],
  },
  Accordion: {
    template: '<div class="accordion"><slot /></div>',
    props: ['type'],
  },
  AccordionItem: {
    template: '<div class="accordion-item"><slot /></div>',
    props: ['value'],
  },
  AccordionTrigger: {
    template: '<button class="accordion-trigger"><slot /></button>',
  },
  AccordionContent: {
    template: '<div class="accordion-content"><slot /></div>',
  },
  RelatedProducts: {
    template: '<div class="related-products" />',
    props: ['products', 'hideHeading'],
  },
};

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    productId: 1,
    name: 'Test Product',
    alias: 'test-product',
    weight: 500,
    categoryId: 1,
    supplierId: 1,
    texts: { text1: '<p>Product description here</p>' },
    parameterGroups: [
      {
        name: 'Dimensions',
        parameterGroupId: 1,
        parameters: [
          {
            name: 'Weight',
            value: '500g',
            show: true,
            identifier: 'weight',
          },
          {
            name: 'Height',
            value: '10cm',
            show: true,
            identifier: 'height',
          },
          {
            name: 'Produkttyp',
            value: 'Elektronik',
            show: false,
            identifier: 'produkttyp',
          },
          {
            name: '',
            show: true,
            identifier: 'empty',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('ProductTabs', () => {
  it('renders details, specifications, documents triggers (no reviews)', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct(), related: [] },
      global: { stubs },
    });
    const triggers = wrapper.findAll('.tabs-trigger');
    expect(triggers.length).toBe(3);
    const labels = triggers.map((t) => t.text());
    expect(labels).toEqual([
      'product.details',
      'product.specifications',
      'product.documents',
    ]);
    expect(labels).not.toContain('product.reviews');
  });

  it('adds related tab when related products exist', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: {
        product: makeProduct(),
        related: [makeListProduct({ productId: 2, name: 'Other' })],
      },
      global: { stubs },
    });
    const triggers = wrapper.findAll('.tabs-trigger');
    expect(triggers.length).toBe(4);
    expect(triggers[3]!.text()).toBe('product.related');
  });

  it('omits related tab when related list is empty or missing', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct(), related: null },
      global: { stubs },
    });
    const labels = wrapper.findAll('.tabs-trigger').map((t) => t.text());
    expect(labels).not.toContain('product.related');
  });

  it('renders description content with v-html', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct(), related: [] },
      global: { stubs },
    });
    const descContent = wrapper.find('.tabs-content[data-value="description"]');
    expect(descContent.html()).toContain('Product description here');
  });

  it('renders both admin Text 2 and Text 3 copy, Text 2 first', () => {
    // Geins offset: API text1 = admin "Text 2", text2 = admin "Text 3",
    // text3 = admin "Text 1" (the last is not part of the details tab).
    const wrapper = mountComponent(ProductTabs, {
      props: {
        product: makeProduct({
          texts: {
            text1: '<p>Admin Text 2 copy</p>',
            text2: '<p>Admin Text 3 copy</p>',
            text3: '<p>Admin Text 1 copy</p>',
          },
        }),
        related: [],
      },
      global: { stubs },
    });
    const html = wrapper.find('.tabs-content[data-value="description"]').html();
    expect(html).toContain('Admin Text 2 copy');
    expect(html).toContain('Admin Text 3 copy');
    expect(html).not.toContain('Admin Text 1 copy');
    expect(html.indexOf('Admin Text 2 copy')).toBeLessThan(
      html.indexOf('Admin Text 3 copy'),
    );
  });

  it('shows the details tab when only admin Text 3 (API text2) has copy', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: {
        product: makeProduct({ texts: { text2: '<p>Only Text 3</p>' } }),
        related: [],
      },
      global: { stubs },
    });
    const labels = wrapper.findAll('.tabs-trigger').map((t) => t.text());
    expect(labels).toContain('product.details');
    const content = wrapper.find('.tabs-content[data-value="description"]');
    expect(content.html()).toContain('Only Text 3');
  });

  it('hides the details tab when text fields are only empty markup', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: {
        product: makeProduct({ texts: { text1: '<p><br></p>', text2: '   ' } }),
        related: [],
      },
      global: { stubs },
    });
    const labels = wrapper.findAll('.tabs-trigger').map((t) => t.text());
    expect(labels).not.toContain('product.details');
  });

  it('caps the details copy column at max-w-3xl (768px)', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct(), related: [] },
      global: { stubs },
    });
    const content = wrapper.find('.tabs-content[data-value="description"]');
    expect(content.html()).toContain('max-w-3xl');
  });

  it('renders only show:true parameters in the specification table', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct(), related: [] },
      global: { stubs },
    });
    const specContent = wrapper.find(
      '.tabs-content[data-value="specifications"]',
    );
    expect(specContent.text()).toContain('Dimensions');
    expect(specContent.text()).toContain('Weight');
    expect(specContent.text()).toContain('500g');
    // `show: false` is the merchant saying "don't display this on the
    // storefront" — Produkttyp/Elektronik carry it and must stay hidden.
    expect(specContent.text()).not.toContain('Produkttyp');
    expect(specContent.text()).not.toContain('Elektronik');
    // Nameless/valueless rows are dropped regardless of `show`.
    expect(specContent.text()).not.toContain('empty');
  });

  it('hides description tab when no text', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct({ texts: undefined }), related: [] },
      global: { stubs },
    });
    const labels = wrapper.findAll('.tabs-trigger').map((t) => t.text());
    expect(labels).not.toContain('product.details');
  });

  it('defaults to specifications when product has no description', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct({ texts: undefined }), related: [] },
      global: { stubs },
    });
    const tabs = wrapper.find('[data-testid="tabs"]');
    expect(tabs.attributes('data-default-value')).toBe('specifications');
  });

  it('hides the Monitor parameter group from specifications', () => {
    const product = makeProduct({
      parameterGroups: [
        {
          name: 'Monitor',
          parameterGroupId: 99,
          parameters: [
            { name: 'StandardUnit-Code', value: 'm', show: true },
            { name: 'CategoryString', value: 'KB', show: true },
          ],
        },
        {
          name: 'Kabelinfo',
          parameterGroupId: 2,
          parameters: [{ name: 'Ledarantal', value: '1', show: true }],
        },
      ],
    });
    const wrapper = mountComponent(ProductTabs, {
      props: { product, related: [] },
      global: { stubs },
    });
    const specContent = wrapper.find(
      '.tabs-content[data-value="specifications"]',
    );
    expect(specContent.text()).not.toContain('Monitor');
    expect(specContent.text()).not.toContain('StandardUnit-Code');
    expect(specContent.text()).toContain('Kabelinfo');
    expect(specContent.text()).toContain('Ledarantal');
  });

  it('renders a VideoURL parameter as an embedded video, not a spec row', () => {
    const product = makeProduct({
      parameterGroups: [
        {
          name: 'Dokumentation',
          parameterGroupId: 46,
          parameters: [
            {
              name: 'VideoURL',
              label: 'VideoURL',
              value: 'https://www.youtube.com/watch?v=abc123',
              show: true,
            },
          ],
        },
      ],
    });
    const wrapper = mountComponent(ProductTabs, {
      props: { product, related: [] },
      global: { stubs },
    });
    const docsContent = wrapper.find('.tabs-content[data-value="documents"]');
    const iframe = docsContent.find('[data-testid="product-videos"] iframe');
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes('src')).toBe(
      'https://www.youtube.com/embed/abc123',
    );

    const specContent = wrapper.find(
      '.tabs-content[data-value="specifications"]',
    );
    expect(specContent.exists()).toBe(false);
  });

  it('renders Manual and ProductSpec parameters as document links', () => {
    const product = makeProduct({
      parameterGroups: [
        {
          name: 'Dokumentation',
          parameterGroupId: 46,
          parameters: [
            {
              name: 'Manual',
              label: 'Manual',
              value: 'https://cdn.example.com/manual.pdf',
              show: true,
            },
            {
              name: 'ProductSpec',
              label: 'ProductSpec',
              value: 'https://cdn.example.com/spec.pdf',
              show: true,
            },
          ],
        },
      ],
    });
    const wrapper = mountComponent(ProductTabs, {
      props: { product, related: [] },
      global: { stubs },
    });
    const docsContent = wrapper.find('.tabs-content[data-value="documents"]');
    const links = docsContent.findAll('[data-testid="product-documents"] a');
    expect(links.length).toBe(2);
    expect(links[0]!.attributes('href')).toBe(
      'https://cdn.example.com/manual.pdf',
    );
    expect(links[0]!.text()).toContain('Manual');
    expect(links[1]!.text()).toContain('Product Spec');
  });

  it('hides a media parameter the merchant marked show:false', () => {
    // `show: false` has to mean the same thing for a video as for a spec
    // row, otherwise hiding a parameter removes it from the table but
    // leaves it playing in the Documents tab.
    const product = makeProduct({
      parameterGroups: [
        {
          name: 'Dokumentation',
          parameterGroupId: 46,
          parameters: [
            {
              name: 'VideoURL',
              value: 'https://www.youtube.com/watch?v=abc123',
              show: false,
            },
            {
              name: 'Manual',
              value: 'https://cdn.example.com/manual.pdf',
              show: false,
            },
          ],
        },
      ],
    });
    const wrapper = mountComponent(ProductTabs, {
      props: { product, related: [] },
      global: { stubs },
    });
    const docsContent = wrapper.find('.tabs-content[data-value="documents"]');
    expect(docsContent.find('[data-testid="product-videos"]').exists()).toBe(
      false,
    );
    expect(docsContent.find('[data-testid="product-documents"]').exists()).toBe(
      false,
    );
  });

  it('prefers the localized label over the technical name in the spec table', () => {
    const product = makeProduct({
      parameterGroups: [
        {
          name: 'Fysiska egenskaper',
          parameterGroupId: 39,
          parameters: [
            {
              name: 'InstallationDiameter',
              label: 'Installationsdiameter',
              value: '25 mm',
              show: true,
            },
          ],
        },
      ],
    });
    const wrapper = mountComponent(ProductTabs, {
      props: { product, related: [] },
      global: { stubs },
    });
    const specContent = wrapper.find(
      '.tabs-content[data-value="specifications"]',
    );
    expect(specContent.text()).toContain('Installationsdiameter');
    expect(specContent.text()).not.toContain('InstallationDiameter');
  });

  it('falls back to a normal spec row when a known media name has a non-URL value', () => {
    const product = makeProduct({
      parameterGroups: [
        {
          name: 'Dokumentation',
          parameterGroupId: 46,
          parameters: [
            { name: 'ProductSpec', value: 'See page 4', show: true },
          ],
        },
      ],
    });
    const wrapper = mountComponent(ProductTabs, {
      props: { product, related: [] },
      global: { stubs },
    });
    const docsContent = wrapper.find('.tabs-content[data-value="documents"]');
    expect(docsContent.text()).toContain('product.no_documents');

    const specContent = wrapper.find(
      '.tabs-content[data-value="specifications"]',
    );
    expect(specContent.text()).toContain('ProductSpec');
    expect(specContent.text()).toContain('See page 4');
  });

  it('shows the no-documents message when no media parameters exist', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: { product: makeProduct(), related: [] },
      global: { stubs },
    });
    const docsContent = wrapper.find('.tabs-content[data-value="documents"]');
    expect(docsContent.text()).toContain('product.no_documents');
  });

  it('renders RelatedProducts inside the related tab', () => {
    const wrapper = mountComponent(ProductTabs, {
      props: {
        product: makeProduct(),
        related: [makeListProduct({ productId: 2, name: 'Other' })],
      },
      global: { stubs },
    });
    const relatedContent = wrapper.find('.tabs-content[data-value="related"]');
    expect(relatedContent.exists()).toBe(true);
    expect(relatedContent.find('.related-products').exists()).toBe(true);
  });
});

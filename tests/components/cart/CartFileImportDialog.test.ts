import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { mountComponent } from '../../utils/component';
import CartFileImportDialog from '../../../app/components/cart/CartFileImportDialog.vue';
import { CART_IMPORT_MAX_FILE_BYTES } from '../../../shared/constants/cart-import';
import type { CartImportPreview } from '../../../shared/types/cart-import';

const mockImportItems = vi.fn();
vi.mock('../../../app/stores/cart', () => ({
  useCartStore: () => ({ cartId: 'cart-1', importItems: mockImportItems }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

const stubs = {
  Dialog: {
    props: ['open'],
    emits: ['update:open'],
    template: '<div v-if="open" data-testid="dialog-root"><slot /></div>',
  },
  DialogContent: { template: '<div v-bind="$attrs"><slot /></div>' },
  DialogHeader: { template: '<div><slot /></div>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogDescription: { template: '<p><slot /></p>' },
  DialogFooter: { template: '<div><slot /></div>' },
  Button: {
    props: ['disabled', 'variant', 'size'],
    emits: ['click'],
    template:
      '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  StockBadge: {
    props: ['status', 'size'],
    template: '<span data-testid="stock-badge">{{ status }}</span>',
  },
};

const PREVIEW: CartImportPreview = {
  status: 'ok',
  columns: { article: 0, quantity: 1, headerRow: 1, headerRecognized: true },
  lines: [
    {
      articleNumber: 'SKRUV-M6',
      skuId: 101,
      name: 'Skruv M6',
      quantity: 4,
      rows: [2],
      inCartQuantity: 2,
      stockStatus: 'in-stock',
      unitPrice: {
        sellingPriceIncVatFormatted: '12,50 kr',
        sellingPriceExVatFormatted: '10,00 kr',
      },
    },
    {
      articleNumber: 'MUTTER-L',
      skuId: 202,
      name: 'Mutter',
      quantity: 1,
      rows: [3],
      inCartQuantity: 0,
      unitPrice: null,
    },
  ],
  problems: [
    {
      reason: 'invalid_quantity',
      rows: [4],
      articleNumber: 'BRICKA',
      quantity: 'x',
    },
    { reason: 'not_found', rows: [5, 9], articleNumber: 'OKAND-1' },
  ],
};

function mount(): VueWrapper {
  return mountComponent(CartFileImportDialog, {
    props: { open: true },
    global: { stubs },
  }) as VueWrapper;
}

async function chooseFile(wrapper: VueWrapper, file: File) {
  const input = wrapper.find('[data-testid="cart-file-import-input"]');
  Object.defineProperty(input.element, 'files', {
    value: [file],
    configurable: true,
  });
  await input.trigger('change');
}

async function showPreview(wrapper: VueWrapper) {
  mockFetch.mockResolvedValueOnce(PREVIEW);
  await chooseFile(wrapper, new File(['Artikelnummer;Antal\n'], 'order.csv'));
  await vi.waitFor(() => {
    expect(
      wrapper.find('[data-testid="cart-file-import-preview"]').exists(),
    ).toBe(true);
  });
}

describe('CartFileImportDialog', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockImportItems.mockReset();
  });

  it('explains the format and offers a CSV template download', () => {
    const wrapper = mount();
    const link = wrapper.find('[data-testid="cart-file-import-template"]');
    expect(link.attributes('download')).toBe(
      'cart.file_import.template_filename',
    );
    const href = decodeURIComponent(link.attributes('href') ?? '');
    expect(href.startsWith('data:text/csv;charset=utf-8,')).toBe(true);
    expect(href).toContain(
      'cart.file_import.template_article_header;cart.file_import.template_quantity_header\r\n',
    );
    expect(wrapper.text()).toContain('cart.file_import.format_help');
  });

  it('gives the file input a label and help text, and accepts only xlsx, xls and csv', () => {
    const wrapper = mount();
    const input = wrapper.find('[data-testid="cart-file-import-input"]');
    const id = input.attributes('id');
    expect(id).toBeTruthy();
    expect(wrapper.find(`label[for="${id}"]`).text()).toBe(
      'cart.file_import.choose_file',
    );
    const help = input.attributes('aria-describedby');
    expect(wrapper.find(`[id="${help}"]`).text()).toContain(
      'cart.file_import.format_help',
    );
    expect(input.attributes('accept')).toBe('.xlsx,.xls,.csv');
  });

  it('refuses a file over 1 MB before uploading it, and announces why', async () => {
    const wrapper = mount();
    await chooseFile(
      wrapper,
      new File([new Uint8Array(CART_IMPORT_MAX_FILE_BYTES + 1)], 'order.csv'),
    );
    const alert = wrapper.find('[data-testid="cart-file-import-error"]');
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toBe('cart.file_import.errors.file_too_large');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a file type it cannot read before uploading it', async () => {
    const wrapper = mount();
    await chooseFile(wrapper, new File(['%PDF'], 'order.pdf'));
    expect(wrapper.find('[data-testid="cart-file-import-error"]').text()).toBe(
      'cart.file_import.errors.unsupported_format',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uploads the file as base64 with the cart id and shows the preview', async () => {
    const wrapper = mount();
    await showPreview(wrapper);

    expect(mockFetch).toHaveBeenCalledWith('/api/cart/import/preview', {
      method: 'POST',
      body: {
        fileName: 'order.csv',
        content: Buffer.from('Artikelnummer;Antal\n').toString('base64'),
        cartId: 'cart-1',
      },
    });
    const rows = wrapper.findAll('[data-testid="cart-file-import-line"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('SKRUV-M6');
    expect(rows[0]!.text()).toContain('12,50 kr');
    expect(rows[0]!.text()).toContain('cart.file_import.in_cart');
    expect(rows[0]!.find('[data-testid="stock-badge"]').text()).toBe(
      'in-stock',
    );
  });

  it('groups the rows that will not be added by reason, with their row numbers', async () => {
    const wrapper = mount();
    await showPreview(wrapper);
    const notFound = wrapper.find(
      '[data-testid="cart-file-import-problem-not_found"]',
    );
    expect(notFound.text()).toContain('cart.file_import.reasons.not_found');
    expect(notFound.text()).toContain('OKAND-1');
    const quantity = wrapper.find(
      '[data-testid="cart-file-import-problem-invalid_quantity"]',
    );
    expect(quantity.text()).toContain('BRICKA');
    // Fix-first order: not found comes before quantity problems.
    const groups = wrapper
      .findAll('[data-testid^="cart-file-import-problem-"]')
      .map((group) => group.attributes('data-testid'));
    expect(groups).toEqual([
      'cart-file-import-problem-not_found',
      'cart-file-import-problem-invalid_quantity',
    ]);
  });

  it('shows the reason the server refused the file', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 'invalid',
      error: 'too_many_rows',
    });
    const wrapper = mount();
    await chooseFile(wrapper, new File(['x'], 'order.xlsx'));
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="cart-file-import-error"]').text(),
      ).toBe('cart.file_import.errors.too_many_rows');
    });
    expect(
      wrapper.find('[data-testid="cart-file-import-preview"]').exists(),
    ).toBe(false);
  });

  it('adds only the lines left after the buyer removes some', async () => {
    mockImportItems.mockResolvedValueOnce({
      added: [{ skuId: 202, quantity: 1, articleNumber: 'MUTTER-L' }],
      failed: [],
    });
    const wrapper = mount();
    await showPreview(wrapper);

    const remove = wrapper.findAll('button[data-remove-line]');
    expect(remove[0]!.attributes('aria-label')).toBe(
      'cart.file_import.remove_line',
    );
    await remove[0]!.trigger('click');
    expect(
      wrapper.findAll('[data-testid="cart-file-import-line"]'),
    ).toHaveLength(1);

    await wrapper.find('[data-testid="cart-file-import-add"]').trigger('click');
    expect(mockImportItems).toHaveBeenCalledWith(
      [
        {
          skuId: 202,
          quantity: 1,
          articleNumber: 'MUTTER-L',
          inCartQuantity: 0,
        },
      ],
      'cart-1',
    );
  });

  it('says when the lines go into a new cart, and adds without the old cart id', async () => {
    mockImportItems.mockResolvedValueOnce({ added: [], failed: [] });
    mockFetch.mockResolvedValueOnce({ ...PREVIEW, newCart: true });
    const wrapper = mount();
    await chooseFile(wrapper, new File(['Artikelnummer;Antal\n'], 'order.csv'));
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="cart-file-import-new-cart"]').text(),
      ).toBe('cart.file_import.new_cart');
    });

    await wrapper.find('[data-testid="cart-file-import-add"]').trigger('click');
    expect(mockImportItems).toHaveBeenCalledWith(
      [
        expect.objectContaining({ skuId: 101, inCartQuantity: 2 }),
        expect.objectContaining({ skuId: 202, inCartQuantity: 0 }),
      ],
      undefined,
    );
  });

  it('drops a reply that arrives after the dialog was closed and opened again', async () => {
    let answer!: (value: CartImportPreview) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<CartImportPreview>((resolve) => {
        answer = resolve;
      }),
    );
    const wrapper = mount();
    await chooseFile(wrapper, new File(['Artikelnummer;Antal\n'], 'order.csv'));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    answer(PREVIEW);
    await flushPromises();

    expect(
      wrapper.find('[data-testid="cart-file-import-preview"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .find('[data-testid="cart-file-import-input"]')
        .attributes('disabled'),
    ).toBeUndefined();
  });

  it('gives focus back to the file input when the file is refused', async () => {
    mockFetch.mockResolvedValueOnce({ status: 'invalid', error: 'no_rows' });
    const wrapper = mountComponent(CartFileImportDialog, {
      props: { open: true },
      global: { stubs },
      attachTo: document.body,
    }) as VueWrapper;
    try {
      await chooseFile(wrapper, new File(['x'], 'order.csv'));
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(
          wrapper.find('[data-testid="cart-file-import-input"]').element,
        );
      });
    } finally {
      wrapper.unmount();
    }
  });

  it('shows what was added and announces what failed, with the reason', async () => {
    mockImportItems.mockResolvedValueOnce({
      added: [{ skuId: 101, quantity: 4, articleNumber: 'SKRUV-M6' }],
      failed: [
        {
          skuId: 202,
          quantity: 1,
          articleNumber: 'MUTTER-L',
          reason: 'rejected',
        },
      ],
    });
    const wrapper = mount();
    await showPreview(wrapper);
    await wrapper.find('[data-testid="cart-file-import-add"]').trigger('click');
    await flushPromises();

    const result = wrapper.find('[data-testid="cart-file-import-result"]');
    expect(result.text()).toContain('cart.file_import.result_added');
    const failed = wrapper.find('[data-testid="cart-file-import-failed"]');
    expect(failed.attributes('role')).toBe('alert');
    expect(failed.text()).toContain('MUTTER-L');
    expect(failed.text()).toContain('cart.file_import.add_failures.rejected');
  });

  it('keeps the preview and says so when adding fails', async () => {
    mockImportItems.mockRejectedValueOnce(
      Object.assign(new Error('502'), { statusCode: 502 }),
    );
    const wrapper = mount();
    await showPreview(wrapper);
    await wrapper.find('[data-testid="cart-file-import-add"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="cart-file-import-error"]').text()).toBe(
      'cart.file_import.errors.add_failed',
    );
    expect(
      wrapper.find('[data-testid="cart-file-import-preview"]').exists(),
    ).toBe(true);
  });

  it('offers nothing to add once every line is removed', async () => {
    const wrapper = mount();
    await showPreview(wrapper);
    for (const button of wrapper.findAll('button[data-remove-line]')) {
      await button.trigger('click');
    }
    expect(
      wrapper
        .find('[data-testid="cart-file-import-add"]')
        .attributes('disabled'),
    ).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountComponent } from '../../utils/component';
import PriceSlot from '../../../app/components/shared/PriceSlot.vue';

// Drives the buyer's inc/ex preference the way the topbar switcher does.
const { showIncVatRef } = vi.hoisted(() => ({
  showIncVatRef: { value: false },
}));

vi.mock('../../../app/composables/useVatDisplay', () => ({
  useVatDisplay: () => ({
    showIncVat: showIncVatRef,
    setShowIncVat: vi.fn(),
    toggle: vi.fn(),
  }),
}));

const price = {
  sellingPriceExVatFormatted: '448 SEK',
  sellingPriceIncVatFormatted: '560 SEK',
};

function render(props: Record<string, unknown> = {}) {
  return mountComponent(PriceSlot, {
    props: { mode: 'list', price, ...props },
  });
}

describe('PriceSlot VAT display', () => {
  beforeEach(() => {
    showIncVatRef.value = false;
  });

  it('follows the buyer preference when the caller omits showVat', () => {
    // The regression: Vue casts an absent Boolean prop to `false`, so the slot
    // forwarded an explicit `false` and PriceDisplay honoured it. Every price
    // on the PDP and on product cards was pinned to ex-VAT, and the topbar
    // switcher changed nothing.
    showIncVatRef.value = true;

    expect(render().text()).toContain('560 SEK');
  });

  it('shows ex-VAT when the preference is ex-VAT', () => {
    showIncVatRef.value = false;

    expect(render().text()).toContain('448 SEK');
  });

  it('lets an explicit showVat=false win over an inc-VAT preference', () => {
    // Checkout passes this deliberately; an explicit choice still beats the
    // preference, which is what `?? ` is there for.
    showIncVatRef.value = true;

    expect(render({ showVat: false }).text()).toContain('448 SEK');
  });

  it('lets an explicit showVat=true win over an ex-VAT preference', () => {
    showIncVatRef.value = false;

    expect(render({ showVat: true }).text()).toContain('560 SEK');
  });
});

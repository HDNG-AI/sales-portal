import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed } from 'vue';
import { mountComponent } from '../../utils/component';
import VatDisplaySwitcher from '../../../app/components/shared/VatDisplaySwitcher.vue';

// Plain state, wrapped in real computed refs inside the mock factories below.
// The template auto-unwraps refs, not plain `{ value }` objects — handed one of
// those, `!isLocked` is `!{…}` and the control renders when it should not.
const state = vi.hoisted(() => ({
  showIncVat: false,
  isLocked: false,
  showPrice: true,
}));

const setShowIncVat = vi.fn();

vi.mock('../../../app/composables/useVatDisplay', () => ({
  useVatDisplay: () => ({
    showIncVat: computed(() => state.showIncVat),
    isLocked: computed(() => state.isLocked),
    setShowIncVat,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../../app/composables/usePriceVisibility', () => ({
  usePriceVisibility: () => ({
    showPrice: computed(() => state.showPrice),
    canUnlockByAuth: computed(() => false),
  }),
}));

describe('VatDisplaySwitcher', () => {
  beforeEach(() => {
    state.showIncVat = false;
    state.isLocked = false;
    state.showPrice = true;
    setShowIncVat.mockClear();
  });

  type Variant = 'icon' | 'text' | 'inline';
  const render = (variant: Variant = 'text') =>
    mountComponent(VatDisplaySwitcher, { props: { variant } });

  it('renders the control when the tenant leaves the choice open', () => {
    expect(render().text()).not.toBe('');
  });

  it('renders nothing when the tenant has locked the VAT display', () => {
    // Odelco. The composable ignores writes while locked, so the control would
    // be inert — and an inert control is worse than none.
    state.isLocked = true;

    expect(render().text()).toBe('');
  });

  it('renders nothing when prices are hidden', () => {
    // Pre-existing gate: no prices, nothing to hold a VAT opinion about.
    state.showPrice = false;

    expect(render().text()).toBe('');
  });

  it.each(['icon', 'text', 'inline'] as const)(
    'stays hidden while locked in the %s variant',
    (variant) => {
      state.isLocked = true;

      expect(render(variant).text()).toBe('');
    },
  );

  // Both gates, all four pairings. The v-if is `showPrice && !isLocked`, so
  // three of the four hide — and the both-false corner is the one a
  // hand-picked set of cases forgets.
  describe('every combination of the two gates', () => {
    const cases: Array<{
      showPrice: boolean;
      isLocked: boolean;
      renders: boolean;
    }> = [
      { showPrice: true, isLocked: false, renders: true },
      { showPrice: true, isLocked: true, renders: false },
      { showPrice: false, isLocked: false, renders: false },
      { showPrice: false, isLocked: true, renders: false },
    ];

    it.each(cases)(
      'showPrice=$showPrice isLocked=$isLocked -> renders=$renders',
      ({ showPrice, isLocked, renders }) => {
        state.showPrice = showPrice;
        state.isLocked = isLocked;

        expect(render().text() !== '').toBe(renders);
      },
    );

    it('covers the whole space', () => {
      expect(cases).toHaveLength(2 * 2);
      expect(
        new Set(cases.map((c) => `${c.showPrice}${c.isLocked}`)).size,
      ).toBe(cases.length);
    });
  });
});

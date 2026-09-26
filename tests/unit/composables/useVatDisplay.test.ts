import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';

// Cookie ref that the mock useCookie returns
const mockCookieValue = ref<'inc' | 'ex' | undefined>(undefined);

// The tenant's half of the decision: what a buyer sees before choosing, and
// whether they may choose at all.
const mockLayout = ref<{
  vatDisplay?: 'ex' | 'inc' | null;
  vatDisplayLocked?: boolean | null;
}>({});

function stubTenant() {
  vi.stubGlobal('useTenant', () => ({
    tenant: computed(() => ({ layout: mockLayout.value })),
  }));
}

// Mocked at the module path as well as globally: the auto-import resolves to
// the real composable, which reaches for useRequestURL and a Nuxt instance
// this tier has not got.
vi.mock('../../../app/composables/useTenant', () => ({
  useTenant: () => ({
    tenant: computed(() => ({ layout: mockLayout.value })),
  }),
}));

// Mock the Nuxt cookie composable
vi.mock('#app/composables/cookie', () => ({
  useCookie: (_n?: string, o?: { default?: () => 'inc' | 'ex' }) => {
    if (mockCookieValue.value === undefined && o?.default) {
      mockCookieValue.value = o.default();
    }
    return mockCookieValue;
  },
}));

// Mock the shared constants so the module loads without path issues
vi.mock('#shared/constants/storage', () => ({
  COOKIE_NAMES: {
    VAT_DISPLAY: 'vat_display',
  },
}));

// Stub Nuxt auto-imports as globals (matches useLocaleMarket.test.ts pattern)
vi.stubGlobal(
  'useCookie',
  (_n?: string, o?: { default?: () => 'inc' | 'ex' }) => {
    if (mockCookieValue.value === undefined && o?.default)
      mockCookieValue.value = o.default();
    return mockCookieValue;
  },
);
vi.stubGlobal('computed', computed);
stubTenant();

describe('useVatDisplay', () => {
  let useVatDisplay: typeof import('../../../app/composables/useVatDisplay').useVatDisplay;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCookieValue.value = undefined;
    mockLayout.value = {};

    // Re-stub after resetModules
    vi.stubGlobal(
      'useCookie',
      (_n?: string, o?: { default?: () => 'inc' | 'ex' }) => {
        if (mockCookieValue.value === undefined && o?.default)
          mockCookieValue.value = o.default();
        return mockCookieValue;
      },
    );
    vi.stubGlobal('computed', computed);
    stubTenant();

    const mod = await import('../../../app/composables/useVatDisplay');
    useVatDisplay = mod.useVatDisplay;
  });

  describe('tenant default and lock', () => {
    it('shows inc-VAT before any choice when the tenant defaults to inc', () => {
      mockLayout.value = { vatDisplay: 'inc' };
      expect(useVatDisplay().showIncVat.value).toBe(true);
    });

    it('still lets the buyer switch away from an inc-VAT default', () => {
      // Default and lock are independent: defaulting to inc does not fix it.
      mockLayout.value = { vatDisplay: 'inc' };
      const { showIncVat, setShowIncVat } = useVatDisplay();
      setShowIncVat(false);
      expect(mockCookieValue.value).toBe('ex');
      expect(showIncVat.value).toBe(false);
    });

    it('forces the tenant value when locked, ignoring a stored choice', () => {
      // Odelco: everyone sees ex-VAT. A buyer who chose inc-VAT earlier must
      // not be left on it once the tenant fixes the display.
      mockLayout.value = { vatDisplay: 'ex', vatDisplayLocked: true };
      mockCookieValue.value = 'inc';
      expect(useVatDisplay().showIncVat.value).toBe(false);
    });

    it('locks to inc-VAT just as readily as to ex-VAT', () => {
      mockLayout.value = { vatDisplay: 'inc', vatDisplayLocked: true };
      mockCookieValue.value = 'ex';
      expect(useVatDisplay().showIncVat.value).toBe(true);
    });

    it('writes no cookie while locked', () => {
      // A stored choice that does nothing is worse than none: it would take
      // effect the day the tenant unlocked the display.
      mockLayout.value = { vatDisplay: 'ex', vatDisplayLocked: true };
      const { setShowIncVat, toggle } = useVatDisplay();
      setShowIncVat(true);
      toggle();
      expect(mockCookieValue.value).toBeUndefined();
    });

    it('reports isLocked so the switcher can hide itself', () => {
      mockLayout.value = { vatDisplayLocked: true };
      expect(useVatDisplay().isLocked.value).toBe(true);
      mockLayout.value = {};
      expect(useVatDisplay().isLocked.value).toBe(false);
    });
  });

  describe('showIncVat', () => {
    it('defaults to ex-VAT (showIncVat false) when no cookie is set', () => {
      mockCookieValue.value = undefined;
      const { showIncVat } = useVatDisplay();
      expect(showIncVat.value).toBe(false);
      // No cookie is written until the buyer actually chooses. The cookie used
      // to carry `default: 'ex'`, which wrote one on first read — and made an
      // unset cookie indistinguishable from a deliberate ex-VAT choice, so a
      // tenant defaulting to inc-VAT could never show it.
      expect(mockCookieValue.value).toBeUndefined();
    });

    it('returns true when cookie value is "inc"', () => {
      mockCookieValue.value = 'inc';
      const { showIncVat } = useVatDisplay();
      expect(showIncVat.value).toBe(true);
    });

    it('returns false when cookie value is "ex"', () => {
      mockCookieValue.value = 'ex';
      const { showIncVat } = useVatDisplay();
      expect(showIncVat.value).toBe(false);
    });
  });

  describe('setShowIncVat', () => {
    it('writes "ex" to cookie and sets showIncVat to false', () => {
      mockCookieValue.value = 'inc';
      const { showIncVat, setShowIncVat } = useVatDisplay();
      setShowIncVat(false);
      expect(mockCookieValue.value).toBe('ex');
      expect(showIncVat.value).toBe(false);
    });

    it('writes "inc" to cookie and sets showIncVat to true', () => {
      mockCookieValue.value = 'ex';
      const { showIncVat, setShowIncVat } = useVatDisplay();
      setShowIncVat(true);
      expect(mockCookieValue.value).toBe('inc');
      expect(showIncVat.value).toBe(true);
    });
  });

  describe('toggle', () => {
    it('flips from inc to ex', () => {
      mockCookieValue.value = 'inc';
      const { showIncVat, toggle } = useVatDisplay();
      toggle();
      expect(mockCookieValue.value).toBe('ex');
      expect(showIncVat.value).toBe(false);
    });

    it('flips from ex to inc', () => {
      mockCookieValue.value = 'ex';
      const { showIncVat, toggle } = useVatDisplay();
      toggle();
      expect(mockCookieValue.value).toBe('inc');
      expect(showIncVat.value).toBe(true);
    });
  });
});

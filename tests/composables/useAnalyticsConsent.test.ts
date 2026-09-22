import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed as vueComputed } from 'vue';

// Track useStorage calls. Cached by key, because the real useStorage returns
// the SAME ref for a given key — a fresh ref per call would hand the footer
// link and the banner independent copies of a value they must share.
const storageRefs = new Map<
  string,
  ReturnType<typeof ref<'accepted' | 'declined' | null>>
>();
const useStorageSpy = vi.fn(
  (key: string, defaultValue: 'accepted' | 'declined' | null) => {
    const existing = storageRefs.get(key);
    if (existing) return existing;
    const created = ref(defaultValue);
    storageRefs.set(key, created);
    return created;
  },
);

vi.mock('@vueuse/core', () => ({
  useStorage: (...args: [string, 'accepted' | 'declined' | null]) =>
    useStorageSpy(...args),
}));

// Mock useTenant — changeable per test via mockTenantId
const mockTenantId = ref('test-tenant');

const mockUseTenant = () => ({
  tenantId: mockTenantId,
});

// useState is Nuxt's SSR-safe shared ref. A plain ref per key is enough here:
// the composable only needs the reopened flag to survive within one caller,
// and the store is cleared between tests so nothing leaks across them.
const nuxtState = new Map<string, ReturnType<typeof ref<boolean>>>();
const mockUseState = (key: string, init: () => boolean) => {
  const existing = nuxtState.get(key);
  if (existing) return existing;
  const created = ref(init());
  nuxtState.set(key, created);
  return created;
};

vi.mock('#imports', () => ({
  useTenant: () => mockUseTenant(),
  computed: (fn: () => unknown) => vueComputed(fn),
  useState: (key: string, init: () => boolean) => mockUseState(key, init),
}));

// The auto-imported useState resolves through #app/composables/state, not
// #imports — without this the real one runs and asks for a Nuxt instance.
vi.mock('#app/composables/state', () => ({
  useState: (key: string, init: () => boolean) => mockUseState(key, init),
}));
vi.stubGlobal('useState', (key: string, init: () => boolean) =>
  mockUseState(key, init),
);

vi.mock('../../app/composables/useTenant', () => ({
  useTenant: () => mockUseTenant(),
}));

describe('useAnalyticsConsent', () => {
  let useAnalyticsConsent: typeof import('../../app/composables/useAnalyticsConsent').useAnalyticsConsent;

  beforeEach(async () => {
    useStorageSpy.mockClear();
    storageRefs.clear();
    mockTenantId.value = 'test-tenant';
    nuxtState.clear();

    vi.resetModules();
    const mod = await import('../../app/composables/useAnalyticsConsent');
    useAnalyticsConsent = mod.useAnalyticsConsent;
  });

  it('defaults consent to false (no interaction yet)', () => {
    const { consent } = useAnalyticsConsent();
    expect(consent.value).toBe(false);
  });

  it('defaults hasInteracted to false', () => {
    const { hasInteracted } = useAnalyticsConsent();
    expect(hasInteracted.value).toBe(false);
  });

  it('uses tenant-scoped localStorage key with null default', () => {
    useAnalyticsConsent();
    expect(useStorageSpy).toHaveBeenCalledWith(
      'analytics-consent-test-tenant',
      null,
    );
  });

  it('accept() sets consent to true and hasInteracted to true', () => {
    const { consent, hasInteracted, accept } = useAnalyticsConsent();
    accept();
    expect(consent.value).toBe(true);
    expect(hasInteracted.value).toBe(true);
  });

  it('revoke() sets consent to false and hasInteracted to true', () => {
    const { consent, hasInteracted, revoke } = useAnalyticsConsent();
    revoke();
    expect(consent.value).toBe(false);
    expect(hasInteracted.value).toBe(true);
  });

  it('accept then revoke sets consent false but hasInteracted stays true', () => {
    const { consent, hasInteracted, accept, revoke } = useAnalyticsConsent();
    accept();
    expect(consent.value).toBe(true);
    revoke();
    expect(consent.value).toBe(false);
    expect(hasInteracted.value).toBe(true);
  });

  it('uses different keys for different tenants', () => {
    mockTenantId.value = 'other-tenant';
    useStorageSpy.mockClear();

    useAnalyticsConsent();

    expect(useStorageSpy).toHaveBeenCalledWith(
      'analytics-consent-other-tenant',
      null,
    );
  });

  it('isPrompting is true before any choice and false once one is stored', () => {
    const { isPrompting, accept } = useAnalyticsConsent();
    expect(isPrompting.value).toBe(true);
    accept();
    expect(isPrompting.value).toBe(false);
  });

  it('reopen() prompts again without discarding the stored choice', () => {
    // The whole point: a visitor reopening the banner to reconsider must not
    // have their existing answer wiped just by looking at it.
    const { isPrompting, consent, hasInteracted, accept, reopen } =
      useAnalyticsConsent();
    accept();
    expect(isPrompting.value).toBe(false);

    reopen();

    expect(isPrompting.value).toBe(true);
    expect(consent.value).toBe(true);
    expect(hasInteracted.value).toBe(true);
  });

  it('revoking from a reopened banner withdraws consent and closes it', () => {
    const { isPrompting, consent, accept, reopen, revoke } =
      useAnalyticsConsent();
    accept();
    reopen();

    revoke();

    expect(consent.value).toBe(false);
    expect(isPrompting.value).toBe(false);
  });

  it('shares the reopened flag across callers', () => {
    // The footer link and the banner are separate components; one calling
    // reopen() has to be visible to the other.
    const link = useAnalyticsConsent();
    const banner = useAnalyticsConsent();
    link.accept();
    expect(banner.isPrompting.value).toBe(false);

    link.reopen();

    expect(banner.isPrompting.value).toBe(true);
  });
});

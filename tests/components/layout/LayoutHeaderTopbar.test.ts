import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { shallowMountComponent } from '../../utils/component';
import LayoutHeaderTopbar from '../../../app/components/layout/header/LayoutHeaderTopbar.vue';

const authStoreState = {
  isAuthenticated: false,
  displayName: '',
  openSheet: vi.fn(),
  logout: vi.fn(),
};

vi.mock('~/stores/auth', () => ({
  useAuthStore: () => authStoreState,
}));

const enabledFeatures = new Set<string>([
  'search',
  'authentication',
  'cart',
  'applyForAccount',
]);

// Drives tenant.layout.showCompanyName per test. `undefined` is the absent
// case — a tenant that never set the key at all.
const showCompanyNameRef = ref<boolean | undefined>(undefined);

vi.mock('../../../app/composables/useTenant', () => ({
  useTenant: () => ({
    hasFeature: (name: string) => enabledFeatures.has(name),
    tenant: computed(() => ({
      layout: { showCompanyName: showCompanyNameRef.value },
    })),
  }),
}));

// The topbar asks for the buyer's company only when the tenant opted in, so
// the stub records whether it was called at all — a tenant with the flag off
// must not pay for the request.
// Hoisted: vi.mock is lifted above ordinary consts, so the factory below can
// only close over values created this way.
const { companyNameRef, executeSpy, useFetchMock } = vi.hoisted(() => {
  const r = { value: 'Odelco AB' as string | null };
  const spy = vi.fn();
  return {
    companyNameRef: r,
    executeSpy: spy,
    useFetchMock: () => ({
      data: { value: { company: { name: r.value } } },
      execute: spy,
    }),
  };
});

// Mocked at the module Nuxt auto-imports resolve to, not only as a global:
// the component's own `useFetch` call goes through the module.
vi.mock('#app/composables/fetch', () => ({
  useFetch: useFetchMock,
  $fetch: vi.fn(),
}));

vi.stubGlobal('useFetch', useFetchMock);

// Controllable refs driven per-test via the helper below
const contactToRef = ref<string | null>('/se/sv/kontakt');
const contactResolvedRef = ref(true);
const applyToRef = ref<string | null>('/se/sv/ansok-om-konto');
const applyResolvedRef = ref(true);

vi.mock('../../../app/composables/useCmsPageLink', () => ({
  useCmsPageLink: (tag: string) => {
    if (tag === 'contact')
      return { to: contactToRef, isResolved: contactResolvedRef };
    if (tag === 'apply')
      return { to: applyToRef, isResolved: applyResolvedRef };
    return { to: ref('/'), isResolved: ref(true) };
  },
}));

describe('LayoutHeaderTopbar', () => {
  beforeEach(() => {
    authStoreState.isAuthenticated = false;
    authStoreState.displayName = '';
    authStoreState.logout.mockClear();
    contactToRef.value = '/se/sv/kontakt';
    contactResolvedRef.value = true;
    applyToRef.value = '/se/sv/ansok-om-konto';
    applyResolvedRef.value = true;
    showCompanyNameRef.value = undefined;
    companyNameRef.value = 'Odelco AB';
    executeSpy.mockClear();
  });

  describe('company name', () => {
    const COMPANY = '[data-testid="topbar-company-name"]';

    it('shows the company when the tenant asked for it', () => {
      authStoreState.isAuthenticated = true;
      showCompanyNameRef.value = true;

      const wrapper = shallowMountComponent(LayoutHeaderTopbar);

      expect(wrapper.find(COMPANY).exists()).toBe(true);
      expect(wrapper.find(COMPANY).text()).toContain('Odelco AB');
    });

    it('hides it when the tenant set the flag false', () => {
      authStoreState.isAuthenticated = true;
      showCompanyNameRef.value = false;

      expect(
        shallowMountComponent(LayoutHeaderTopbar).find(COMPANY).exists(),
      ).toBe(false);
    });

    it('hides it when the tenant never set the key', () => {
      // The default. Every tenant that predates this flag lands here, so it
      // has to be the quiet one.
      authStoreState.isAuthenticated = true;
      showCompanyNameRef.value = undefined;

      expect(
        shallowMountComponent(LayoutHeaderTopbar).find(COMPANY).exists(),
      ).toBe(false);
    });

    it('does not fetch the company for an anonymous visitor', () => {
      // /api/portal/company requires auth, so asking before login is a
      // guaranteed 401 on every page view.
      authStoreState.isAuthenticated = false;
      showCompanyNameRef.value = true;

      shallowMountComponent(LayoutHeaderTopbar);

      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('hides the block when the buyer has no company on file', () => {
      // Normal for a private customer; an empty chip would be worse than none.
      authStoreState.isAuthenticated = true;
      showCompanyNameRef.value = true;
      companyNameRef.value = null;

      expect(
        shallowMountComponent(LayoutHeaderTopbar).find(COMPANY).exists(),
      ).toBe(false);
    });
  });

  it('does not render anonymous login or account-application actions', () => {
    authStoreState.isAuthenticated = false;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    expect(wrapper.text()).not.toContain('auth.login');
    expect(wrapper.text()).not.toContain('layout.apply_for_account');
    expect(wrapper.find('[data-testid="topbar-login"]').exists()).toBe(false);
  });

  it('shows the Customer portal link (not the buyer email) when authenticated', () => {
    authStoreState.isAuthenticated = true;
    authStoreState.displayName = 'ada@example.com';
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    expect(wrapper.text()).toContain('layout.customer_portal');
    // The buyer's email/displayName must no longer leak into the topbar.
    expect(wrapper.text()).not.toContain('ada@example.com');
    // Login control is replaced by the authenticated controls.
    expect(wrapper.find('[data-testid="topbar-login"]').exists()).toBe(false);
  });

  it('Customer portal link points at the localized /portal route', () => {
    authStoreState.isAuthenticated = true;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    const portalLink = wrapper.find('[data-testid="topbar-portal"]');
    expect(portalLink.exists()).toBe(true);
    expect(portalLink.attributes('href')).toBe('/se/en/portal');
  });

  it('renders a logout button that triggers the store logout when authenticated', async () => {
    authStoreState.isAuthenticated = true;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    const logoutButton = wrapper.find('[data-testid="topbar-logout"]');
    expect(logoutButton.exists()).toBe(true);
    expect(wrapper.text()).toContain('auth.logout');
    await logoutButton.trigger('click');
    expect(authStoreState.logout).toHaveBeenCalledTimes(1);
  });

  it('shows neither portal link nor logout button when not authenticated', () => {
    authStoreState.isAuthenticated = false;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    expect(wrapper.find('[data-testid="topbar-portal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="topbar-logout"]').exists()).toBe(false);
  });

  it('(a) contact anchor href equals the CMS-resolved value from useCmsPageLink', () => {
    contactToRef.value = '/se/sv/kontakt';
    contactResolvedRef.value = true;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    // NuxtLink stub renders as <a :href="to">; find the contact anchor by aria-label
    const contactAnchor = wrapper.find('a[aria-label="layout.contact_us"]');
    expect(contactAnchor.exists()).toBe(true);
    expect(contactAnchor.attributes('href')).toBe('/se/sv/kontakt');
  });

  it('(b) contact anchor is absent when useCmsPageLink yields isResolved false', () => {
    contactToRef.value = null;
    contactResolvedRef.value = false;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    const contactAnchor = wrapper.find('a[aria-label="layout.contact_us"]');
    expect(contactAnchor.exists()).toBe(false);
  });

  it('does not render the applyForAccount anchor in the utility topbar', () => {
    authStoreState.isAuthenticated = false;
    applyToRef.value = '/se/sv/ansok-om-konto';
    applyResolvedRef.value = true;
    const wrapper = shallowMountComponent(LayoutHeaderTopbar);
    expect(wrapper.find('a[href="/se/sv/ansok-om-konto"]').exists()).toBe(
      false,
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
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

vi.mock('../../../app/composables/useTenant', () => ({
  useTenant: () => ({
    hasFeature: (name: string) => enabledFeatures.has(name),
  }),
}));

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
    expect(wrapper.find('a[href="/se/sv/ansok-om-konto"]').exists()).toBe(false);
  });
});

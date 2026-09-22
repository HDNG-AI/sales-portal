import { describe, it, expect, beforeEach, assert, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { PublicTenantConfig } from '#shared/types/tenant-config';
import { mountComponent } from '../../utils/component';
import CookieBanner from '../../../app/components/shared/CookieBanner.vue';
import { useTenant } from '../../../app/composables/useTenant';
import { useAnalyticsConsent } from '../../../app/composables/useAnalyticsConsent';

// The banner is `!hasInteracted && hasFeature('analytics')`. `hasFeature` comes
// from the useTenant mock in tests/setup-components.ts, which reads the tenant
// fixture, so writing `features` here drives the real read.
//
// There is nothing to un-mock: this component asks `hasFeature`, not
// `canAccess`, so the tier-wide useFeatureAccess mock is not in the path. That
// is also why the key has no access cells — see the coverage map.
const { tenant } = useTenant();

function setFeatures(features: PublicTenantConfig['features']) {
  assert.isDefined(tenant.value);
  tenant.value.features = features;
}

// useCmsPageLink reaches for useFetch and useRequestURL, which need a Nuxt
// instance the component tier has not got. Same shape as the topbar spec's
// mock (tests/components/layout/LayoutHeaderTopbar.test.ts:36), with refs the
// tests drive so both the resolved and unresolved branches are reachable.
const privacyToRef = ref('/se/sv/integritetspolicy');
const privacyResolvedRef = ref(true);

vi.mock('../../../app/composables/useCmsPageLink', () => ({
  useCmsPageLink: () => ({ to: privacyToRef, isResolved: privacyResolvedRef }),
}));

// Teleport renders to document.body, which the wrapper cannot see; stubbing it
// keeps the dialog inline. Precedent:
// tests/components/layout/LayoutHeaderMobileSearch.test.ts:17.
const stubs = { teleport: true };

const BANNER = '[role="dialog"]';

function findBanner() {
  return mountComponent(CookieBanner, { global: { stubs } }).find(BANNER);
}

describe('CookieBanner', () => {
  beforeEach(() => {
    setFeatures({});
    privacyToRef.value = '/se/sv/integritetspolicy';
    privacyResolvedRef.value = true;
    // useAnalyticsConsent is backed by useStorage, and `isolate: false` lets
    // localStorage outlive a single spec. A stored choice would make
    // hasInteracted true and hide the banner whatever the feature says.
    localStorage.clear();
  });

  it('shows the cookie banner when analytics is enabled', () => {
    setFeatures({ analytics: { enabled: true } });
    const banner = findBanner();
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('cookies.banner_text');
  });

  it('hides the cookie banner when analytics is disabled', () => {
    setFeatures({ analytics: { enabled: false } });
    expect(findBanner().exists()).toBe(false);
  });

  it('hides the cookie banner when analytics is absent from features', () => {
    setFeatures({});
    expect(findBanner().exists()).toBe(false);
  });

  it('hides the cookie banner once a choice is stored', () => {
    setFeatures({ analytics: { enabled: true } });
    assert.isDefined(tenant.value);
    localStorage.setItem(
      `analytics-consent-${tenant.value.tenantId}`,
      JSON.stringify('accepted'),
    );
    expect(findBanner().exists()).toBe(false);
  });

  it('shows the banner again after reopen(), with the stored choice intact', async () => {
    // The whole point of the footer entry point: `revoke()` is otherwise
    // unreachable once a choice is stored, so consent cannot be withdrawn.
    setFeatures({ analytics: { enabled: true } });
    assert.isDefined(tenant.value);
    localStorage.setItem(
      `analytics-consent-${tenant.value.tenantId}`,
      JSON.stringify('accepted'),
    );
    expect(findBanner().exists()).toBe(false);

    useAnalyticsConsent().reopen();
    await nextTick();

    expect(findBanner().exists()).toBe(true);
    // Reopening is not an answer. Asserted against what is persisted rather
    // than a derived ref, because that is what has to survive: closing the
    // banner again must not have turned a settled choice into a blank.
    expect(
      localStorage.getItem(`analytics-consent-${tenant.value.tenantId}`),
    ).toBe(JSON.stringify('accepted'));
  });

  it('links the banner to the CMS privacy policy when one is tagged', () => {
    // Accept/Decline without saying what is collected is not informed consent.
    setFeatures({ analytics: { enabled: true } });
    privacyToRef.value = '/se/sv/integritetspolicy';
    privacyResolvedRef.value = true;

    const link = mountComponent(CookieBanner, { global: { stubs } }).find(
      '[data-testid="cookie-privacy-link"]',
    );

    expect(link.exists()).toBe(true);
    expect(link.attributes('href') ?? link.attributes('to')).toBe(
      '/se/sv/integritetspolicy',
    );
  });

  it('still shows the banner when no privacy page is tagged', () => {
    // A tenant that has not tagged one must still get a consent prompt; the
    // link is the part that goes missing, not the banner.
    setFeatures({ analytics: { enabled: true } });
    privacyResolvedRef.value = false;

    const wrapper = mountComponent(CookieBanner, { global: { stubs } });

    expect(wrapper.find(BANNER).exists()).toBe(true);
    expect(wrapper.find('[data-testid="cookie-privacy-link"]').exists()).toBe(
      false,
    );
  });
});

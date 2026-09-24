import { describe, it, expect, beforeEach, assert } from 'vitest';
import type { PublicTenantConfig } from '#shared/types/tenant-config';
import { mountComponent } from '../../utils/component';
import CookieSettingsLink from '../../../app/components/shared/CookieSettingsLink.vue';
import { useAnalyticsConsent } from '../../../app/composables/useAnalyticsConsent';
import { useTenant } from '../../../app/composables/useTenant';

const { tenant } = useTenant();

function setFeatures(features: PublicTenantConfig['features']) {
  assert.isDefined(tenant.value);
  tenant.value.features = features;
}

/**
 * Analytics only counts as configured when the feature is on AND a provider id
 * is present — the prompt must not ask about cookies nothing would set.
 */
function enableAnalytics() {
  assert.isDefined(tenant.value);
  tenant.value.features = { analytics: { enabled: true } };
  tenant.value.seo = { ...tenant.value.seo, googleAnalyticsId: 'G-TEST123' };
}

const LINK = '[data-testid="cookie-settings-link"]';

describe('CookieSettingsLink', () => {
  beforeEach(() => {
    setFeatures({});
    localStorage.clear();
  });

  it('renders when analytics is enabled', () => {
    enableAnalytics();
    expect(mountComponent(CookieSettingsLink).find(LINK).exists()).toBe(true);
  });

  it('renders nothing when analytics is disabled', () => {
    // A tenant that runs no analytics has no consent to withdraw, so a link
    // here would open a prompt about nothing.
    setFeatures({ analytics: { enabled: false } });
    expect(mountComponent(CookieSettingsLink).find(LINK).exists()).toBe(false);
  });

  it('renders nothing when analytics is absent from features', () => {
    setFeatures({});
    expect(mountComponent(CookieSettingsLink).find(LINK).exists()).toBe(false);
  });

  it('reopens the consent prompt when clicked', async () => {
    // The reason this component exists: after a choice is stored the banner
    // hides for good, leaving revoke() with no caller a visitor can reach.
    enableAnalytics();
    assert.isDefined(tenant.value);
    localStorage.setItem(
      `analytics-consent-${tenant.value.tenantId}`,
      JSON.stringify('accepted'),
    );
    const { isPrompting } = useAnalyticsConsent();
    expect(isPrompting.value).toBe(false);

    await mountComponent(CookieSettingsLink).find(LINK).trigger('click');

    expect(isPrompting.value).toBe(true);
  });

  it('is a button, not a link to nowhere', () => {
    // It performs an action on this page; an <a href="#"> would be a lie to
    // assistive tech and would scroll the page on activation.
    enableAnalytics();
    const el = mountComponent(CookieSettingsLink).find(LINK);
    expect(el.element.tagName).toBe('BUTTON');
    expect(el.attributes('type')).toBe('button');
  });

  it('renders nothing when analytics is enabled but no provider is configured', () => {
    // Nothing is set, so there is nothing to withdraw — a link here would open
    // a prompt about cookies that never existed.
    assert.isDefined(tenant.value);
    tenant.value.features = { analytics: { enabled: true } };
    tenant.value.seo = { googleAnalyticsId: '', googleTagManagerId: '' };

    expect(mountComponent(CookieSettingsLink).find(LINK).exists()).toBe(false);
  });
});

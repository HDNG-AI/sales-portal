/**
 * Analytics plugin — conditionally loads GA/GTM based on tenant config,
 * the NUXT_PUBLIC_FEATURES_ANALYTICS feature flag, and user consent (GDPR).
 *
 * Scripts stay dormant until useAnalyticsConsent().accept() is called
 * (e.g. from a future cookie banner component).
 *
 * Uses @nuxt/scripts registry composables for privacy-aware, performance-optimized loading.
 * Only runs client-side — analytics scripts serve no purpose during SSR.
 */
export default defineNuxtPlugin({
  name: 'tenant-analytics',
  async setup() {
    // Analytics only makes sense on the client
    if (import.meta.server) return;

    const { tenant, analyticsConfigured, suspense } = useTenant();

    await suspense();

    if (!tenant.value?.isActive) return;

    // Gate 1: global runtime config kill switch
    const config = useRuntimeConfig();
    if (!config.public.features.analytics) return;

    // Gate 2: per-tenant feature flag AND a configured provider. Shared with
    // the consent prompt, which must not ask about cookies this would never
    // set — see analyticsConfigured in composables/useTenant.ts.
    if (!analyticsConfigured.value) return;

    const gaId = tenant.value.seo?.googleAnalyticsId;
    const gtmId = tenant.value.seo?.googleTagManagerId;

    const { consent } = useAnalyticsConsent();
    const trigger = useScriptTriggerConsent({ consent });

    if (gaId) {
      useScriptGoogleAnalytics({ id: gaId, scriptOptions: { trigger } });
    }

    if (gtmId) {
      useScriptGoogleTagManager({ id: gtmId, scriptOptions: { trigger } });
    }
  },
});

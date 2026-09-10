import { createTenant } from '../utils/tenant-crud';
import { DEFAULT_CMS_CONFIG } from '../utils/tenant';
import { STOREFRONT_SETTINGS_DEFAULTS } from '../utils/storefront-settings-defaults';
import { logger } from '../utils/logger';

const STAGING_HOSTNAME = 'staging-odelco.hdng.ai';
const STAGING_TENANT_ID = 'odelco-staging-local';

/**
 * Temporary HDNG-only staging continuity bootstrap.
 *
 * Remove this plugin as soon as the Geins store-settings endpoint resolves
 * STAGING_HOSTNAME. Geins remains the intended hostname/tenant authority.
 *
 * This plugin is opt-in and must never affect odelco.se or arbitrary hosts.
 *
 * The local tenant intentionally inherits the Sales Portal's CURRENT canonical
 * CMS registry and baseline feature defaults. This lets staging render whatever
 * the current Geins account exposes through the new portal without depending on
 * the legacy Ralph storefront configuration. Merchant-gated features such as
 * orderPlacement/priceVisibility/stockStatus keep their canonical safe defaults.
 */
export default defineNitroPlugin(async () => {
  if (process.env.ODELCO_STAGING_BOOTSTRAP !== '1') return;

  const apiKey = process.env.GEINS_API_KEY?.trim();
  const accountName = process.env.GEINS_ACCOUNT_NAME?.trim();

  if (!apiKey || !accountName) {
    throw new Error(
      'ODELCO_STAGING_BOOTSTRAP=1 requires GEINS_API_KEY and GEINS_ACCOUNT_NAME',
    );
  }

  const rawChannel = process.env.GEINS_CHANNEL?.trim() || '1';
  const [channelFromEnv, tldFromChannel] = rawChannel.split('|');
  const channel = channelFromEnv || '1';
  const tld = process.env.GEINS_TLD?.trim() || tldFromChannel || 'se';

  await createTenant({
    hostname: STAGING_HOSTNAME,
    tenantId: STAGING_TENANT_ID,
    config: {
      isActive: true,
      mode: 'commerce',
      checkoutMode: 'hosted',
      branding: {
        name: 'Odelco',
        watermark: 'full',
      },
      features: {
        ...STOREFRONT_SETTINGS_DEFAULTS.features,
        search: { enabled: true },
      },
      cms: DEFAULT_CMS_CONFIG,
      geinsSettings: {
        apiKey,
        accountName,
        channel,
        tld,
        locale: 'sv-SE',
        // The Sales Portal URL model uses a two-letter market alias. Merchant
        // API verification on 2026-09-10 proved both "se" and "SE|SEK" return
        // the same published Odelco product on channel 1|se, so use "se" here
        // to keep /se/sv/ routing valid.
        market: 'se',
        environment: 'production',
        availableLocales: ['sv-SE'],
        availableMarkets: ['se'],
      },
    },
  });

  logger.warn(
    `[odelco-staging-bootstrap] ENABLED host=${STAGING_HOSTNAME} tenant=${STAGING_TENANT_ID}; current Sales Portal CMS/default features; temporary local KV authority`,
  );
});

import { createTenant } from '../utils/tenant-crud';
import { DEFAULT_CMS_CONFIG } from '../utils/tenant';
import { STOREFRONT_SETTINGS_DEFAULTS } from '../utils/storefront-settings-defaults';
import { logger } from '../utils/logger';
import { CMS_SLOTS } from '#shared/types/cms-slots';
import { CMS_MENUS } from '#shared/constants/cms';

const STAGING_HOSTNAME = 'staging-odelco.hdng.ai';
const STAGING_TENANT_ID = 'odelco-staging-local';

/**
 * Temporary HDNG-only Odelco staging continuity bootstrap.
 *
 * Remove this plugin as soon as the Geins store-settings endpoint resolves
 * STAGING_HOSTNAME with Odelco's native Studio theme. Geins remains the
 * intended hostname/tenant authority.
 *
 * This plugin is opt-in and can never affect odelco.se or arbitrary hosts.
 *
 * Odelco's canonical values come from HDNG-AI/odelco-storefront:
 * - design/tema/odelco-theme.json
 * - design/original/manual/odelco-storefront-designsystem.html
 *
 * The CMS slot/menu mappings are Odelco-specific names verified against
 * Merchant API in odelco-storefront issue #3.
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
      theme: {
        name: 'odelco',
        displayName: 'Odelco',
        radius: '0.25rem',
        typography: {
          fontFamily: 'Inter',
          headingFontFamily: 'Roboto Slab',
          monoFontFamily: 'JetBrains Mono',
        },
        colors: {
          primary: 'oklch(0.728 0.172 56.0)',
          primaryForeground: 'oklch(1.000 0.000 0.0)',
          secondary: 'oklch(0.218 0.000 0.0)',
          secondaryForeground: 'oklch(1.000 0.000 0.0)',
          background: 'oklch(1.000 0.000 0.0)',
          foreground: 'oklch(0.218 0.000 0.0)',
          card: 'oklch(1.000 0.000 0.0)',
          cardForeground: 'oklch(0.218 0.000 0.0)',
          popover: 'oklch(1.000 0.000 0.0)',
          popoverForeground: 'oklch(0.218 0.000 0.0)',
          muted: 'oklch(0.985 0.003 106.4)',
          mutedForeground: 'oklch(0.566 0.000 0.0)',
          accent: 'oklch(0.969 0.021 72.2)',
          accentForeground: 'oklch(0.653 0.161 53.8)',
          destructive: 'oklch(0.540 0.177 27.0)',
          destructiveForeground: 'oklch(1.000 0.000 0.0)',
          border: 'oklch(0.914 0.007 80.7)',
          input: 'oklch(0.825 0.011 81.8)',
          ring: 'oklch(0.728 0.172 56.0)',
          chart1: 'oklch(0.728 0.172 56.0)',
          chart2: 'oklch(0.343 0.070 252.4)',
          chart3: 'oklch(0.516 0.120 152.9)',
          chart4: 'oklch(0.617 0.134 69.4)',
          chart5: 'oklch(0.566 0.000 0.0)',
          sidebar: 'oklch(0.985 0.003 106.4)',
          sidebarForeground: 'oklch(0.218 0.000 0.0)',
          sidebarPrimary: 'oklch(0.728 0.172 56.0)',
          sidebarPrimaryForeground: 'oklch(1.000 0.000 0.0)',
          sidebarAccent: 'oklch(0.969 0.021 72.2)',
          sidebarAccentForeground: 'oklch(0.653 0.161 53.8)',
          sidebarBorder: 'oklch(0.914 0.007 80.7)',
          sidebarRing: 'oklch(0.728 0.172 56.0)',
          topBarBackground: 'oklch(0.218 0.000 0.0)',
          topBarText: 'oklch(1.000 0.000 0.0)',
          footerBackground: 'oklch(0.218 0.000 0.0)',
          footerText: 'oklch(0.985 0 0 / 0.75)',
          navBarBackground: 'oklch(1.000 0.000 0.0)',
          siteBackground: 'oklch(0.985 0.003 106.4)',
          buttonBackground: 'oklch(0.218 0.000 0.0)',
          buttonPurchaseBackground: 'oklch(0.728 0.172 56.0)',
        },
      },
      features: {
        ...STOREFRONT_SETTINGS_DEFAULTS.features,
        search: { enabled: true },
        // Odelco's anonymous storefront qualifies rather than sells:
        // stock is public, while customer-specific prices and ordering
        // unlock after authentication.
        stockStatus: { enabled: true, access: 'all' },
        priceVisibility: { enabled: true, access: 'authenticated' },
        orderPlacement: { enabled: true, access: 'authenticated' },
      },
      cms: {
        ...DEFAULT_CMS_CONFIG,
        slots: {
          ...DEFAULT_CMS_CONFIG.slots,
          [CMS_SLOTS.FRONTPAGE_CONTENT]: {
            family: 'Frontpage',
            areaName: 'The front page area',
          },
          [CMS_SLOTS.PRODUCT_LIST_TOP]: {
            family: 'Productlist',
            areaName: 'The top part of the product list',
          },
          [CMS_SLOTS.PRODUCT_LIST_BOTTOM]: {
            family: 'Productlist',
            areaName: 'The bottom part of the product list',
          },
          [CMS_SLOTS.PRODUCT_DETAIL]: {
            family: 'Product',
            areaName: 'Product detail page',
          },
        },
        menus: {
          ...DEFAULT_CMS_CONFIG.menus,
          [CMS_MENUS.HEADER_MAIN]: { menuLocationId: 'main-desktop' },
          [CMS_MENUS.MOBILE_DRAWER]: { menuLocationId: 'main-mobile' },
          [CMS_MENUS.FOOTER]: { menuLocationId: 'footer-first' },
          [CMS_MENUS.FOOTER_2]: { menuLocationId: 'footer-second' },
          [CMS_MENUS.FOOTER_3]: { menuLocationId: 'footer-third' },
        },
      },
      geinsSettings: {
        apiKey,
        accountName,
        channel,
        tld,
        locale: 'sv-SE',
        market: 'se',
        environment: 'production',
        availableLocales: ['sv-SE'],
        availableMarkets: ['se'],
      },
    },
  });

  logger.warn(
    `[odelco-staging-bootstrap] ENABLED host=${STAGING_HOSTNAME} tenant=${STAGING_TENANT_ID}; Odelco theme/CMS overrides + current Sales Portal defaults; temporary local KV authority`,
  );
});

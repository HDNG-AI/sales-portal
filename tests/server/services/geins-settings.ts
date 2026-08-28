import type { GeinsSettings } from '#shared/types/tenant-config';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

// GEINS_TEST_* — deliberately namespaced apart from the bare GEINS_* names
// DEFAULT_GEINS_SETTINGS reads in server/utils/tenant.ts. That one is the
// app's runtime fallback and must stay generic; this one is a real account's
// credentials for live integration tests, and the two must never collide on
// the same env var name (see docs/lessons-learned.md).
export const geinsSettings: GeinsSettings = {
  apiKey: process.env.GEINS_TEST_API_KEY!,
  accountName: process.env.GEINS_TEST_ACCOUNT_NAME!,
  channel: process.env.GEINS_TEST_CHANNEL!,
  tld: process.env.GEINS_TEST_TLD!,
  locale: process.env.GEINS_TEST_LOCALE!,
  market: process.env.GEINS_TEST_MARKET!,
  environment:
    (process.env.GEINS_TEST_ENVIRONMENT as 'production' | 'staging') ||
    'staging',
};

export const userCredentials = {
  username: process.env.GEINS_TEST_USERNAME || '',
  password: process.env.GEINS_TEST_PASSWORD || '',
  rememberUser: true,
};

export const cmsSettings = {
  area: {
    family: process.env.GEINS_TEST_CMS_FAMILY || '',
    areaName: process.env.GEINS_TEST_CMS_AREA || '',
  },
  page: {
    alias: process.env.GEINS_TEST_CMS_PAGE_ALIAS || '',
  },
};

/**
 * Returns true if Geins API credentials are configured.
 * Integration tests should skip when credentials are not available.
 */
export function hasGeinsCredentials(): boolean {
  return !!(
    process.env.GEINS_TEST_API_KEY &&
    process.env.GEINS_TEST_ACCOUNT_NAME &&
    process.env.GEINS_TEST_CHANNEL
  );
}

/** Returns true if CRM test user credentials are configured. */
export function hasCrmCredentials(): boolean {
  return !!(process.env.GEINS_TEST_USERNAME && process.env.GEINS_TEST_PASSWORD);
}

/** Returns true if CMS test content identifiers are configured. */
export function hasCmsContent(): boolean {
  return !!(
    process.env.GEINS_TEST_CMS_FAMILY && process.env.GEINS_TEST_CMS_AREA
  );
}

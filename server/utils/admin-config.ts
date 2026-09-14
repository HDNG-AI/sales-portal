import type { H3Event } from 'h3';

/**
 * Reads the admin auth secrets from runtime config.
 *
 * Isolated in its own module so unit tests can mock it without booting
 * Nuxt — same reasoning as readErrorHandlerConfig in ./error-config.ts:
 * `useRuntimeConfig` is an auto-import resolved by Nitro's build-time
 * transformer, and tier-1 (node) tests don't run through that transformer.
 *
 * `adminReadSecret` is optional: leaving it unset simply means no
 * read-only credential exists, and only the write secret opens anything.
 */
export function readAdminAuthConfig(event: H3Event): {
  adminSecret: string;
  adminReadSecret: string;
} {
  const config = useRuntimeConfig(event);
  return {
    adminSecret: String(config.adminSecret ?? ''),
    adminReadSecret: String(config.adminReadSecret ?? ''),
  };
}

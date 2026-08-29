import type { H3Event } from 'h3';

/**
 * Reads the admin auth secret from runtime config.
 *
 * Isolated in its own module so unit tests can mock it without booting
 * Nuxt — same reasoning as readErrorHandlerConfig in ./error-config.ts:
 * `useRuntimeConfig` is an auto-import resolved by Nitro's build-time
 * transformer, and tier-1 (node) tests don't run through that transformer.
 */
export function readAdminAuthConfig(event: H3Event): { adminSecret: string } {
  const config = useRuntimeConfig(event);
  return { adminSecret: String(config.adminSecret ?? '') };
}

import type { H3Event } from 'h3';

/**
 * Reads the cart ownership key from runtime config.
 *
 * Isolated in its own module so unit tests can mock it without booting
 * Nuxt, for the reason ./admin-config.ts gives. Empty means unset.
 */
export function readCartOwnerSecret(event: H3Event): string {
  return String(useRuntimeConfig(event).cartOwnerSecret ?? '');
}

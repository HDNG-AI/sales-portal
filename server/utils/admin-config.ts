import type { H3Event } from 'h3';

/**
 * Comma-separated hostnames from runtime config, lowercased and trimmed.
 * Nuxt hands over an env value that parses as JSON already parsed, so an
 * array is accepted as well as a string.
 */
export function parseHostnameList(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  return [
    ...new Set(
      parts.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0),
    ),
  ];
}

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
 * The same holds for `adminCatalogSecret`, the key that opens only the
 * guest-hidden-brands endpoints. An empty `adminCatalogHostnames` leaves
 * that key unrestricted by hostname.
 */
export function readAdminAuthConfig(event: H3Event): {
  adminSecret: string;
  adminReadSecret: string;
  adminCatalogSecret: string;
  adminCatalogHostnames: string[];
} {
  const config = useRuntimeConfig(event);
  return {
    adminSecret: String(config.adminSecret ?? ''),
    adminReadSecret: String(config.adminReadSecret ?? ''),
    adminCatalogSecret: String(config.adminCatalogSecret ?? ''),
    adminCatalogHostnames: parseHostnameList(config.adminCatalogHostnames),
  };
}

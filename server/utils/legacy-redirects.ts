/**
 * A tenant-scoped VirtueMart/Ralph legacy URL map. The generated map is held
 * in KV and never bundled with the shared storefront. This pure matcher is
 * deliberately kept equivalent to the generator in PR #16.
 */
export interface LegacyRedirectMap {
  version: 1;
  prefix: string;
  exact: Record<string, string>;
  articleNumber: Record<string, string>;
  ancestor: Record<string, string>;
}

const LOCALE_PREFIX = /^\/[a-z]{2}\/[a-z]{2}$/;
const MAX_RULES = 12_000;

/** Equivalent to PR #16's legacy-path normalization (including VM noise). */
export function normalizeLegacyPath(rawPath: string): string {
  let path = rawPath.split('?')[0]!.split('#')[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape must never crash page routing.
  }
  path = path.replace(/\/+$/, '') || '/';
  const noise = /\/(dirDesc|dirAsc|results,[\d-]+|by,[^/]+|orderby[^/]*)$/;
  let previous: string | null = null;
  while (previous !== path) {
    previous = path;
    path = path.replace(noise, '');
  }
  return path.toLowerCase();
}

function isSafeTarget(path: string, prefix: string): boolean {
  const hasControl = [...path].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!path.startsWith(`${prefix}/`) || path.includes('//') ||
      /[\\?#%]/.test(path) || hasControl) return false;
  const segments = path.split('/');
  return !segments.some((seg) => seg === '..' || seg === '.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reject the *whole* map if any redirect points outside the declared locale.
 * Tenant KVs must never be able to induce cross-origin redirects, loops or
 * unsafe URLs. A corrupt/half-written map makes the middleware pass through.
 */
export function validateLegacyRedirectMap(input: unknown): LegacyRedirectMap | null {
  if (!isRecord(input) || input.version !== 1 ||
      typeof input.prefix !== 'string' || !LOCALE_PREFIX.test(input.prefix)) {
    return null;
  }
  const prefix = input.prefix;
  const keys = ['exact', 'articleNumber', 'ancestor'] as const;
  let rows = 0;
  for (const key of keys) {
    const table = input[key];
    if (!isRecord(table)) return null;
    for (const [from, to] of Object.entries(table)) {
      rows++;
      if (rows > MAX_RULES || !from || typeof to !== 'string' ||
          !isSafeTarget(to, prefix) ||
          (key !== 'articleNumber' && (!from.startsWith('/') || from.startsWith('//')))) {
        return null;
      }
    }
  }
  return input as unknown as LegacyRedirectMap;
}

function ownValue(record: Record<string, string>, key: string): string | null {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] ?? null : null;
}

/** Match priority: curated exact > any-depth articleNumber-info > ancestor. */
export function resolveLegacyRedirect(map: LegacyRedirectMap, rawPath: string): string | null {
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\')) {
    return null;
  }
  const path = normalizeLegacyPath(rawPath);
  // Deny traversal/ambiguous decoded paths before evaluating ancestor rules.
  // Encoded slashes and backslashes must not become a second URL grammar.
  if (path.startsWith('//') || path.includes('\\') ||
      path.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  const exact = ownValue(map.exact, path);
  if (exact) return exact;

  const leaf = path.slice(path.lastIndexOf('/') + 1);
  if (leaf.endsWith('-info')) {
    const value = ownValue(map.articleNumber, leaf.slice(0, -'-info'.length));
    if (value) return value;
  }

  // Only the explicit ancestor table is traversed, never an exact root row.
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
    const value = ownValue(map.ancestor, path.slice(0, cut));
    if (value) return value;
  }
  return null;
}

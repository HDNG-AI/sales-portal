import { describe, it, expect, vi } from 'vitest';

// The plugin's default export calls defineNitroPlugin() at module scope —
// a Nitro auto-import unavailable in this test tier. Stub it before import
// so the module loads; sanitizeUrl itself has no Nitro dependency.
vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn);

const { sanitizeUrl } =
  await import('../../../../server/plugins/01.request-logging');

describe('sanitizeUrl', () => {
  it('redacts a sensitive query param value, case-insensitively', () => {
    expect(sanitizeUrl('/api/admin/tenants?key=supersecret123')).toBe(
      '/api/admin/tenants?key=%5BREDACTED%5D',
    );
    expect(sanitizeUrl('/api/admin/tenants?KEY=supersecret123')).toBe(
      '/api/admin/tenants?KEY=%5BREDACTED%5D',
    );
  });

  it('leaves non-sensitive params untouched', () => {
    expect(sanitizeUrl('/api/products?category=boats&sort=price')).toBe(
      '/api/products?category=boats&sort=price',
    );
  });

  it('redacts only the sensitive params in a mixed query string', () => {
    expect(sanitizeUrl('/api/foo?key=abc&token=def&other=1')).toBe(
      '/api/foo?key=%5BREDACTED%5D&token=%5BREDACTED%5D&other=1',
    );
  });

  it('returns a path with no query string unchanged', () => {
    expect(sanitizeUrl('/api/health')).toBe('/api/health');
  });

  it('returns a path with an empty query string unchanged', () => {
    expect(sanitizeUrl('/api/health?')).toBe('/api/health?');
  });

  it('redacts a secret carried by a compound param name', () => {
    // The impersonation JWT (server/api/auth/login-as.get.ts) and the
    // password-reset key are the two secrets this app actually puts in a
    // query string, and neither name equals an entry in the list.
    expect(sanitizeUrl('/account?loginToken=eyJhbGciOi.payload.sig')).toBe(
      '/account?loginToken=%5BREDACTED%5D',
    );
    expect(sanitizeUrl('/reset?resetKey=abc123')).toBe(
      '/reset?resetKey=%5BREDACTED%5D',
    );
    expect(sanitizeUrl('/x?api_key=abc&access_token=def')).toBe(
      '/x?api_key=%5BREDACTED%5D&access_token=%5BREDACTED%5D',
    );
  });

  it('does not redact a param that merely contains a sensitive substring', () => {
    expect(sanitizeUrl('/s?keyword=boots&monkey=1&tokenizer=x')).toBe(
      '/s?keyword=boots&monkey=1&tokenizer=x',
    );
  });

  it('keeps a literal question mark in a value instead of truncating', () => {
    expect(sanitizeUrl('/s?q=what?next&token=secret')).toBe(
      '/s?q=what%3Fnext&token=%5BREDACTED%5D',
    );
  });

  it('leaves the query string byte-identical when nothing is redacted', () => {
    // URLSearchParams re-encodes on round-trip, which would silently change
    // every logged path and any metric dimension derived from it.
    expect(sanitizeUrl('/api/products?sort=price:asc&q=a%20b')).toBe(
      '/api/products?sort=price:asc&q=a%20b',
    );
  });
});

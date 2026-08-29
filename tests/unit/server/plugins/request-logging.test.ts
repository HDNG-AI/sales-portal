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
});

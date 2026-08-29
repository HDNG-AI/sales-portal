import { describe, it, expect, vi } from 'vitest';

// The route file's default export calls defineEventHandler() at module
// scope — a Nitro/H3 auto-import unavailable in this test tier. Stub it
// before import so the module loads; isValidAdminKey itself has no
// Nitro/H3 dependency.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);

const { isValidAdminKey } =
  await import('../../../../../server/api/admin/tenants.post');

describe('isValidAdminKey', () => {
  it('accepts a provided key matching the configured secret', () => {
    expect(isValidAdminKey('correct-secret', 'correct-secret')).toBe(true);
  });

  it('rejects a provided key that does not match', () => {
    expect(isValidAdminKey('wrong-secret', 'correct-secret')).toBe(false);
  });

  it('rejects when no key is provided', () => {
    expect(isValidAdminKey(undefined, 'correct-secret')).toBe(false);
  });

  it('rejects when no secret is configured, even if a key is provided', () => {
    expect(isValidAdminKey('anything', undefined)).toBe(false);
    expect(isValidAdminKey('anything', '')).toBe(false);
  });

  it('rejects a provided key that is a prefix or different length', () => {
    expect(isValidAdminKey('correct', 'correct-secret')).toBe(false);
    expect(isValidAdminKey('correct-secret-extra', 'correct-secret')).toBe(
      false,
    );
  });
});

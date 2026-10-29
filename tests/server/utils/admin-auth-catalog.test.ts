import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { H3Event } from 'h3';

// Every request carries its own header and config on the fake event, so tests
// running concurrently in this file never share a mock's return value.
interface FakeEvent {
  key?: string;
  config: {
    adminSecret?: string;
    adminReadSecret?: string;
    adminCatalogSecret?: string;
    adminCatalogHostnames?: string[];
  };
  limited?: boolean;
}

vi.mock('../../../server/utils/rate-limiter', () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    check: async (ip: string) => ({
      allowed: ip !== 'limited',
      remaining: 4,
      resetTime: 0,
    }),
  })),
  getClientIp: vi.fn((event: FakeEvent) => (event.limited ? 'limited' : 'ip')),
}));
vi.mock('h3', () => ({
  getHeader: (event: FakeEvent, name: string) =>
    name === 'x-admin-key' ? event.key : undefined,
}));
vi.mock('../../../server/utils/admin-config', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../server/utils/admin-config')>();
  return {
    ...actual,
    readAdminAuthConfig: (event: FakeEvent) => event.config,
  };
});

vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
});

const { requireAdminAuth, requireCatalogAdminAuth } =
  await import('../../../server/utils/admin-auth');
const { parseHostnameList } =
  await import('../../../server/utils/admin-config');

const SECRETS = {
  adminSecret: 'write-secret',
  adminReadSecret: 'read-secret',
  adminCatalogSecret: 'catalog-secret',
};

function req(
  key: string | undefined,
  config: FakeEvent['config'] = SECRETS,
  limited = false,
): H3Event {
  return { key, config, limited } as unknown as H3Event;
}

describe('catalog key on the guest-hidden-brands gate', () => {
  it('opens both reads and writes', async () => {
    await expect(
      requireCatalogAdminAuth(
        req('catalog-secret'),
        'read',
        'shop.example.com',
      ),
    ).resolves.toEqual({ scope: 'read', catalog: true });
    await expect(
      requireCatalogAdminAuth(
        req('catalog-secret'),
        'write',
        'shop.example.com',
      ),
    ).resolves.toEqual({ scope: 'write', catalog: true });
  });

  it('does not exist when no catalog secret is configured', async () => {
    const config = { ...SECRETS, adminCatalogSecret: '' };
    await expect(
      requireCatalogAdminAuth(req('catalog-secret', config), 'read', 'a.com'),
    ).rejects.toThrow('UNAUTHORIZED');
    // An empty header must not match an empty secret either.
    await expect(
      requireCatalogAdminAuth(req('', config), 'write', 'a.com'),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects a wrong or missing key', async () => {
    await expect(
      requireCatalogAdminAuth(req('nope'), 'read', 'a.com'),
    ).rejects.toThrow('UNAUTHORIZED');
    await expect(
      requireCatalogAdminAuth(req(undefined), 'read', 'a.com'),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('is rate limited before any key is compared', async () => {
    await expect(
      requireCatalogAdminAuth(
        req('catalog-secret', SECRETS, true),
        'read',
        'a.com',
      ),
    ).rejects.toThrow('RATE_LIMITED');
  });
});

describe('catalog key hostname restriction', () => {
  const restricted = {
    ...SECRETS,
    adminCatalogHostnames: ['shop.example.com', 'staging-shop.example.com'],
  };

  it('opens a listed hostname, whatever its case', async () => {
    await expect(
      requireCatalogAdminAuth(
        req('catalog-secret', restricted),
        'write',
        'Shop.Example.com',
      ),
    ).resolves.toEqual({ scope: 'write', catalog: true });
  });

  it('answers 403 for any other hostname, an alias included', async () => {
    for (const hostname of [
      'other.example.com',
      'shop-alias.example.com',
      '',
    ]) {
      await expect(
        requireCatalogAdminAuth(
          req('catalog-secret', restricted),
          'read',
          hostname,
        ),
      ).rejects.toThrow('FORBIDDEN');
    }
  });

  it('does not restrict the full write key', async () => {
    await expect(
      requireCatalogAdminAuth(
        req('write-secret', restricted),
        'write',
        'other.example.com',
      ),
    ).resolves.toEqual({ scope: 'write', catalog: false });
  });
});

describe('existing keys on the guest-hidden-brands gate', () => {
  it('accepts the write key for reads and writes', async () => {
    await expect(
      requireCatalogAdminAuth(req('write-secret'), 'read', 'a.com'),
    ).resolves.toEqual({ scope: 'write', catalog: false });
    await expect(
      requireCatalogAdminAuth(req('write-secret'), 'write', 'a.com'),
    ).resolves.toEqual({ scope: 'write', catalog: false });
  });

  it('accepts the read key for reads only', async () => {
    await expect(
      requireCatalogAdminAuth(req('read-secret'), 'read', 'a.com'),
    ).resolves.toEqual({ scope: 'read', catalog: false });
    await expect(
      requireCatalogAdminAuth(req('read-secret'), 'write', 'a.com'),
    ).rejects.toThrow('UNAUTHORIZED');
  });
});

describe('catalog key on every other admin route', () => {
  it('is refused by requireAdminAuth for reads and writes', async () => {
    await expect(
      requireAdminAuth(req('catalog-secret'), 'read'),
    ).rejects.toThrow('UNAUTHORIZED');
    await expect(
      requireAdminAuth(req('catalog-secret'), 'write'),
    ).rejects.toThrow('UNAUTHORIZED');
    await expect(requireAdminAuth(req('catalog-secret'))).rejects.toThrow(
      'UNAUTHORIZED',
    );
  });

  it('leaves the write and read keys working exactly as before', async () => {
    await expect(requireAdminAuth(req('write-secret'))).resolves.toEqual({
      scope: 'write',
    });
    await expect(requireAdminAuth(req('read-secret'), 'read')).resolves.toEqual(
      {
        scope: 'read',
      },
    );
    await expect(requireAdminAuth(req('read-secret'), 'write')).rejects.toThrow(
      'UNAUTHORIZED',
    );
  });

  it('is wired into the guest-hidden-brands routes and no others', () => {
    // The catalog gate is opt-in per route. Walk the admin API so a future
    // route cannot start accepting the catalog key without this failing.
    const root = join(process.cwd(), 'server/api/admin');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(root);

    const usingCatalogGate = files
      .filter((f) =>
        readFileSync(f, 'utf8').includes('requireCatalogAdminAuth'),
      )
      .map((f) => f.slice(root.length + 1))
      .sort();
    expect(usingCatalogGate).toEqual([
      'tenants/[hostname]/guest-hidden-brands.get.ts',
      'tenants/[hostname]/guest-hidden-brands.put.ts',
    ]);
    for (const f of files) {
      const source = readFileSync(f, 'utf8');
      if (!source.includes('requireCatalogAdminAuth')) {
        expect(source, f).toContain('requireAdminAuth(');
      }
    }
  });
});

describe('parseHostnameList', () => {
  it('splits, trims, lowercases and deduplicates a comma list', () => {
    expect(
      parseHostnameList(
        ' Shop.example.com, ,staging.example.com,shop.example.com ',
      ),
    ).toEqual(['shop.example.com', 'staging.example.com']);
  });

  it('accepts an already parsed array and treats anything else as empty', () => {
    expect(parseHostnameList(['A.com', 'b.com'])).toEqual(['a.com', 'b.com']);
    expect(parseHostnameList('')).toEqual([]);
    expect(parseHostnameList(undefined)).toEqual([]);
    expect(parseHostnameList(42)).toEqual([]);
  });
});

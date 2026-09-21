import { describe, it, expect } from 'vitest';
import { CreateTenantSchema } from '../../server/schemas/admin-input';

describe('CreateTenantSchema', () => {
  it('accepts a minimal payload with only hostname', () => {
    const result = CreateTenantSchema.safeParse({ hostname: 'a.example.com' });
    expect(result.success).toBe(true);
  });

  it('accepts aliases as an array of hostnames', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'www.boattools.store',
      tenantId: 'boattools',
      aliases: ['boattools.localhost', 'boattools.example.com'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aliases).toEqual([
        'boattools.localhost',
        'boattools.example.com',
      ]);
    }
  });

  it('accepts multiple aliases for the same tenant', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'www.boattools.store',
      tenantId: 'boattools',
      aliases: ['boattools.localhost', 'boattools-alias.localhost'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aliases).toEqual([
        'boattools.localhost',
        'boattools-alias.localhost',
      ]);
    }
  });

  it('rejects an empty string inside aliases', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      aliases: [''],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing hostname', () => {
    const result = CreateTenantSchema.safeParse({ tenantId: 'a-tenant' });
    expect(result.success).toBe(false);
  });

  it('accepts a full real-world payload (the boattools onboarding shape)', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'www.boattools.store',
      tenantId: 'boattools',
      aliases: ['boattools.localhost'],
      branding: { name: 'Boat Tools' },
      geinsSettings: {
        apiKey: 'key-1',
        accountName: 'boattools_prod',
        channel: '1',
        tld: 'se',
        locale: 'sv-SE',
        market: 'se',
        environment: 'production',
        imageBaseUrl: 'https://boattools.commerce.services',
      },
      timezone: 'Europe/Stockholm',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a payload with timezone omitted, substituting no zone', () => {
    const result = CreateTenantSchema.safeParse({ hostname: 'a.example.com' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.timezone).toBeUndefined();
  });

  it('rejects a raw UTC offset instead of an IANA timezone identifier', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      timezone: 'GMT+1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown geinsSettings.environment value', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      geinsSettings: {
        apiKey: 'x',
        accountName: 'acct',
        channel: '1',
        tld: 'se',
        locale: 'sv-SE',
        market: 'se',
        environment: 'sandbox',
      },
    });
    expect(result.success).toBe(false);
  });

  it('normalizes hostname and aliases to lowercase, trimmed', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: '  MyStore.Example.com  ',
      aliases: ['Store.Localhost'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hostname).toBe('mystore.example.com');
      expect(result.data.aliases).toEqual(['store.localhost']);
    }
  });

  it('rejects an unrecognized top-level field instead of silently dropping it', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      features: { cart: { enabled: false } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an allowUpdate flag', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      allowUpdate: true,
    });
    expect(result.success).toBe(true);
  });

  it('coerces theme colors from hex to oklch instead of accepting an arbitrary string', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      theme: {
        name: 'Acme',
        colors: {
          primary: '#3b82f6',
          primaryForeground: '#ffffff',
          secondary: '#f3f4f6',
          secondaryForeground: '#111111',
          background: '#ffffff',
          foreground: '#111111',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.theme?.colors.primary).toMatch(/^oklch\(/);
    }
  });

  it('rejects theme colors missing one of the 6 required core colors', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      theme: {
        name: 'Acme',
        colors: { primary: '#3b82f6' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a cms slot pointing at a real Geins Studio family/areaName', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      cms: {
        slots: {
          frontpage_content: {
            family: 'Frontpage',
            areaName: 'The front page area',
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cms?.slots?.frontpage_content).toEqual({
        family: 'Frontpage',
        areaName: 'The front page area',
      });
    }
  });

  it('accepts a payload with cms omitted (a tenant without CMS wiring just gets the empty-state fallback)', () => {
    const result = CreateTenantSchema.safeParse({ hostname: 'a.example.com' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cms).toBeUndefined();
  });

  it('rejects a cms slot missing its required family or areaName', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      cms: { slots: { frontpage_content: { family: 'Frontpage' } } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts null for a cms slot or menu — the "remove this key" update sentinel', () => {
    const result = CreateTenantSchema.safeParse({
      hostname: 'a.example.com',
      cms: {
        slots: { product_detail: null },
        menus: { footer: null },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cms?.slots?.product_detail).toBeNull();
      expect(result.data.cms?.menus?.footer).toBeNull();
    }
  });
});

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

  it('accepts a payload with timezone omitted (createTenant defaults it to UTC)', () => {
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
});

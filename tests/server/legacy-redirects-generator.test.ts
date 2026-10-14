import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Standalone Node ESM utility; it is intentionally not compiled by TypeScript.
// @ts-expect-error No .d.ts for the independent .mjs command-line generator.
import { fetchAllProducts, main, shortLocaleCode, toAppPath } from '../../infra/scripts/generate-legacy-redirects.mjs';

const channel = {
  id: '1|se', name: 'Odelco test', url: 'https://example.test',
  defaultMarketId: 'SE|SEK',
  markets: [{
    id: 'SE|SEK', alias: 'se', defaultLanguageId: 'sv-SE',
    allowedLanguages: [{ id: 'sv-SE', code: 'sv-SE' }, { id: 'en-US', code: 'en-US' }],
  }],
};
const product = (i: number) => ({
  productId: i,
  articleNumber: `A${i}`,
  name: `Example ${i}`,
  canonicalUrl: `/se/sv-SE/p/example-${i}`,
});

const originalArgv = [...process.argv];
const envNames = ['GEINS_API_KEY', 'GEINS_CHANNEL_ID', 'GEINS_API_ENDPOINT', 'GEINS_LANGUAGE_ID', 'GEINS_MARKET_ID'] as const;
const originalEnv = Object.fromEntries(envNames.map((k) => [k, process.env[k]]));
let folder = '';

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'odelco-redirect-regression-'));
  process.argv = [originalArgv[0]!, originalArgv[1]!, '--out', join(folder, 'map.json')];
  process.env.GEINS_API_KEY = 'mock-key';
  process.env.GEINS_CHANNEL_ID = '1|se';
  process.env.GEINS_API_ENDPOINT = 'https://merchant.mock/graphql';
  delete process.env.GEINS_LANGUAGE_ID;
  delete process.env.GEINS_MARKET_ID;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.argv = [...originalArgv];
  for (const k of envNames) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  rmSync(folder, { recursive: true, force: true });
});

/** A mocked Merchant API that inspects every GraphQL query. */
function mockApi(pages: (skip: number) => { count: number; products: ReturnType<typeof product>[] },
  configuredChannel = channel) {
  const queries: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL) => {
    const query = new URL(String(input)).searchParams.get('query') ?? '';
    queries.push(query);
    if (query.includes('channel(')) return Response.json({ data: { channel: configuredChannel } });
    if (query.includes('products(')) {
      const skip = Number(/skip:(\d+)/.exec(query)?.[1] ?? 0);
      return Response.json({ data: { products: pages(skip) } });
    }
    if (query.includes('categories(')) return Response.json({ data: { categories: [] } });
    if (query.includes('brands(')) return Response.json({ data: { brands: [] } });
    if (query.includes('cmsPages(')) return Response.json({ data: { cmsPages: [] } });
    throw new Error('Unexpected GraphQL query: ' + query);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { queries, fetchMock };
}

describe('legacy redirect generator: route locale normalization', () => {
  it('transforms full BCP-47 languages to the short app route segment', () => {
    expect(shortLocaleCode('sv-SE')).toBe('sv');
    expect(shortLocaleCode('en-US')).toBe('en');
    expect(shortLocaleCode('SV-se')).toBe('sv');
    expect(shortLocaleCode('sv')).toBe('sv');
    expect(shortLocaleCode('bad-locale-extra')).toBeNull();
    expect(toAppPath('/se/sv-SE/l/batteriladdare', 'category')).toBe('/se/sv/c/batteriladdare');
    expect(toAppPath('/se/en-US/p/a1', 'product')).toBe('/se/en/p/a1');
    expect(toAppPath('/se/sv-SE/l/actisense', 'brand')).toBe('/se/sv/b/actisense');
    expect(toAppPath('//another-origin.example/p/a1', 'product')).toBeNull();
  });

  it('uses selected market allowedLanguages; produces /se/sv and not /se/sv-SE', async () => {
    const { queries } = mockApi(() => ({ count: 1, products: [product(1)] }));
    await main();
    expect(queries[0]).toContain('allowedLanguages');
    expect(queries[0]).toContain('defaultLanguageId');
    expect(queries[0]).not.toContain('languages{');
    const data = JSON.parse(readFileSync(join(folder, 'map.json'), 'utf8'));
    expect(data.prefix).toBe('/se/sv');
    expect(data.articleNumber.a1).toBe('/se/sv/p/example-1');
    expect(data.counts.articleNumber).toBe(1);
  });

  it('rejects a language that is not allowed for the selected market', async () => {
    process.env.GEINS_LANGUAGE_ID = 'fr-FR';
    const { queries } = mockApi(() => ({ count: 1, products: [product(1)] }));
    await expect(main()).rejects.toThrow(/not allowed/);
    expect(queries).toHaveLength(1);
    expect(existsSync(join(folder, 'map.json'))).toBe(false);
  });
});

describe('legacy redirect generator: stable complete paging before writes', () => {
  it('sends ALPHABETICAL sort on every page and fetches all 201 distinct products', async () => {
    const all = Array.from({ length: 201 }, (_, i) => product(i + 1));
    const { queries } = mockApi((skip) => ({
      count: all.length, products: all.slice(skip, skip + 200),
    }));
    const result = await fetchAllProducts('https://merchant.mock/graphql', 'mock-key', {
      channelId: '1|se', languageId: 'sv-SE', marketId: 'SE|SEK',
    });
    expect(result).toHaveLength(201);
    expect(new Set(result.map((p: { productId: number }) => p.productId)).size).toBe(201);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('skip:0,take:200,filter:{sort:ALPHABETICAL}');
    expect(queries[1]).toContain('skip:200,take:200,filter:{sort:ALPHABETICAL}');
  });

  it('refuses a duplicate product in later pages and writes no partial map', async () => {
    const first = Array.from({ length: 200 }, (_, i) => product(i + 1));
    const { queries } = mockApi((skip) => ({
      count: 201, products: skip === 0 ? first : [product(1)],
    }));
    await expect(main()).rejects.toThrow(/repeated a product/);
    expect(queries.filter((q) => q.includes('products('))).toHaveLength(2);
    expect(existsSync(join(folder, 'map.json'))).toBe(false);
  });

  it('refuses a short first page and writes no partial map', async () => {
    const first = Array.from({ length: 199 }, (_, i) => product(i + 1));
    const { queries } = mockApi(() => ({ count: 201, products: first }));
    await expect(main()).rejects.toThrow(/Short Geins products page/);
    expect(queries.filter((q) => q.includes('products('))).toHaveLength(1);
    expect(existsSync(join(folder, 'map.json'))).toBe(false);
  });

  it('refuses product count drift between two pages', async () => {
    const first = Array.from({ length: 200 }, (_, i) => product(i + 1));
    mockApi((skip) => skip === 0
      ? { count: 201, products: first }
      : { count: 202, products: [product(201), product(202)] });
    await expect(main()).rejects.toThrow(/count changed during paging/);
    expect(existsSync(join(folder, 'map.json'))).toBe(false);
  });
});

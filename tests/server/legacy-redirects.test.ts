import { describe, expect, it } from 'vitest';
import {
  normalizeLegacyPath,
  resolveLegacyRedirect,
  validateLegacyRedirectMap,
  type LegacyRedirectMap,
} from '../../server/utils/legacy-redirects';

const map: LegacyRedirectMap = {
  version: 1,
  prefix: '/se/sv',
  exact: {
    '/produkter': '/se/sv/products',
    '/produkter/digital-switching': '/se/sv/c/digital-switching',
    '/varumarken/actisense': '/se/sv/b/actisense',
  },
  articleNumber: { a3702: '/se/sv/p/nmea/maretron-a3702' },
  ancestor: { '/produkter/digital-switching': '/se/sv/c/digital-switching' },
};

describe('tenant legacy redirect matcher (parity with generator #16)', () => {
  it('normalizes VirtueMart paging, sort, unicode and mixed case', () => {
    expect(normalizeLegacyPath('/produkter/X/results,1-0?clearCart=0')).toBe('/produkter/x');
    expect(normalizeLegacyPath('/produkter/X/dirDesc')).toBe('/produkter/x');
    expect(normalizeLegacyPath('/produkter/X/results,1-0/dirDesc')).toBe('/produkter/x');
    expect(normalizeLegacyPath('/produkter/BAM030710100-info')).toBe('/produkter/bam030710100-info');
    expect(normalizeLegacyPath('/produkter/batteri%C3%B6vervakning'))
      .toBe('/produkter/batteriövervakning');
  });

  it('matches curated exact, then leaf article number at any depth', () => {
    expect(resolveLegacyRedirect(map, '/varumarken/ACTISENSE?layout=details'))
      .toBe('/se/sv/b/actisense');
    expect(resolveLegacyRedirect(map, '/produkter/A3702-info'))
      .toBe('/se/sv/p/nmea/maretron-a3702');
    expect(resolveLegacyRedirect(map, '/random/other/A3702-info'))
      .toBe('/se/sv/p/nmea/maretron-a3702');
  });

  it('uses explicit ancestors for deprecated children but never an exact root as fallback', () => {
    expect(resolveLegacyRedirect(map, '/produkter/digital-switching/lost/old-info'))
      .toBe('/se/sv/c/digital-switching');
    expect(resolveLegacyRedirect(map, '/produkter/unknown-info')).toBeNull();
    expect(resolveLegacyRedirect(map, '/unknown/path')).toBeNull();
  });

  it('rejects encoded traversal and protocol-relative input even if ancestor matches', () => {
    expect(resolveLegacyRedirect(map, '//evil.test/produkter/A3702-info')).toBeNull();
    expect(resolveLegacyRedirect(map, '/produkter/digital-switching/%2e%2e/x-info'))
      .toBeNull();
    expect(resolveLegacyRedirect(map, '/produkter/digital-switching/%5cattacker/x-info'))
      .toBeNull();
  });

  it('never treats inherited JS prototype keys as redirect entries', () => {
    expect(resolveLegacyRedirect(map, '/__proto__-info')).toBeNull();
    expect(resolveLegacyRedirect(map, '/constructor-info')).toBeNull();
  });
});

describe('KV redirect map validation', () => {
  it('accepts a generated v1 map, including article-only or empty tables', () => {
    expect(validateLegacyRedirectMap(map)).toEqual(map);
    expect(validateLegacyRedirectMap({
      version: 1, prefix: '/se/sv', exact: {}, articleNumber: {}, ancestor: {},
    })).not.toBeNull();
  });

  it('denies absent, old-version and malformed maps', () => {
    expect(validateLegacyRedirectMap(null)).toBeNull();
    expect(validateLegacyRedirectMap({ ...map, version: 2 })).toBeNull();
    expect(validateLegacyRedirectMap({ ...map, prefix: '/SE/sv' })).toBeNull();
    expect(validateLegacyRedirectMap({ ...map, exact: [] })).toBeNull();
  });

  it('rejects entire map on any off-origin, encoded or unsafe target', () => {
    for (const target of [
      'https://evil.example/p', '//evil.example/p', '/fi/sv/p/x',
      '/se/sv/p/../x', '/se/sv/p/%2e%2e/x', '/se/sv/p/x?redirect=evil',
      '/se/sv/p/x#section', '/se/sv/p\\evil', '/se/sv/p//bad',
    ]) {
      expect(validateLegacyRedirectMap({
        ...map, exact: { '/produkter/test': target },
      })).toBeNull();
    }
  });

  it('enforces an upper rule-count limit against malformed giant KV blobs', () => {
    const exact = Object.fromEntries(Array.from(
      { length: 12_001 }, (_, i) => [`/original-${i}`, '/se/sv/p/good'],
    ));
    expect(validateLegacyRedirectMap({ ...map, exact })).toBeNull();
  });
});

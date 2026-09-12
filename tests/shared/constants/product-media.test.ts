import { describe, it, expect } from 'vitest';
import {
  classifyMediaParameter,
  PRODUCT_MEDIA_PARAMETER_DEFAULTS,
} from '../../../shared/constants/product-media';

describe('classifyMediaParameter', () => {
  it('classifies a known name against the default table when no table is passed', () => {
    const result = classifyMediaParameter({
      name: 'VideoURL',
      value: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result[0]?.kind).toBe('video');
  });

  it("uses a tenant's own table instead of the defaults when one is passed", () => {
    const tenantTable = { producturl: 'video' as const };

    // "VideoURL" isn't in this tenant's table, so the default match doesn't apply.
    expect(
      classifyMediaParameter(
        { name: 'VideoURL', value: 'https://cdn.example.com/vid.mp4' },
        tenantTable,
      ),
    ).toEqual([]);

    // "ProductURL" is this tenant's own name for the same concept.
    const result = classifyMediaParameter(
      { name: 'ProductURL', value: 'https://cdn.example.com/vid.mp4' },
      tenantTable,
    );
    expect(result[0]?.kind).toBe('video');
  });

  it("lets a tenant extend the defaults with a name their PIM uses instead (e.g. 'Datasheet' instead of 'Manual')", () => {
    const tenantTable = {
      ...PRODUCT_MEDIA_PARAMETER_DEFAULTS,
      datasheet: 'document' as const,
    };

    const extended = classifyMediaParameter(
      { name: 'Datasheet', value: 'https://cdn.example.com/spec.pdf' },
      tenantTable,
    );
    expect(extended[0]?.kind).toBe('document');

    // The defaults this tenant didn't override still work.
    const stillDefault = classifyMediaParameter(
      { name: 'Manual', value: 'https://cdn.example.com/manual.pdf' },
      tenantTable,
    );
    expect(stillDefault[0]?.kind).toBe('document');
  });

  it('still requires a URL-shaped value even with a custom table', () => {
    const tenantTable = { datasheet: 'document' as const };
    const result = classifyMediaParameter(
      { name: 'Datasheet', value: 'Contact sales for the datasheet' },
      tenantTable,
    );
    expect(result).toEqual([]);
  });

  it('respects exactly the table it is given, with no hidden fallback to the defaults', () => {
    // In practice server/utils/tenant.ts always merges PRODUCT_MEDIA_PARAMETER_DEFAULTS
    // under a tenant's own table before this function ever sees it, so a
    // real tenant can't reach an empty table — this confirms the function
    // itself doesn't quietly reintroduce the defaults if a caller ever did
    // pass one.
    const result = classifyMediaParameter(
      { name: 'VideoURL', value: 'https://www.youtube.com/watch?v=abc123' },
      {},
    );
    expect(result).toEqual([]);
  });
});

describe('classifyMediaParameter — multi-value parameters', () => {
  it('splits a pipe-delimited value into one entry per URL', () => {
    const result = classifyMediaParameter({
      name: 'Manual',
      value:
        'https://cdn.example.com/manual-en.pdf|https://cdn.example.com/manual-sv.pdf',
    });
    expect(result.map((m) => m.url)).toEqual([
      'https://cdn.example.com/manual-en.pdf',
      'https://cdn.example.com/manual-sv.pdf',
    ]);
    expect(result.every((m) => m.kind === 'document')).toBe(true);
  });

  it('returns exactly one entry for a single URL', () => {
    const result = classifyMediaParameter({
      name: 'Manual',
      value: 'https://cdn.example.com/manual.pdf',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe('https://cdn.example.com/manual.pdf');
  });

  it('returns an empty array for an unmapped name', () => {
    const result = classifyMediaParameter({
      name: 'Weight',
      value: 'https://cdn.example.com/thing.pdf',
    });
    expect(result).toEqual([]);
  });

  it('returns an empty array when no piece is a usable URL', () => {
    const result = classifyMediaParameter({
      name: 'Manual',
      value: 'Contact sales|ask your rep',
    });
    expect(result).toEqual([]);
  });

  it('keeps the valid pieces and drops the invalid ones', () => {
    const result = classifyMediaParameter({
      name: 'Manual',
      value:
        'https://cdn.example.com/good.pdf|not-a-url|https://cdn.example.com/also-good.pdf',
    });
    expect(result.map((m) => m.url)).toEqual([
      'https://cdn.example.com/good.pdf',
      'https://cdn.example.com/also-good.pdf',
    ]);
  });

  it('trims whitespace around pieces and drops empty segments', () => {
    const result = classifyMediaParameter({
      name: 'Manual',
      value:
        ' https://cdn.example.com/a.pdf || https://cdn.example.com/b.pdf |',
    });
    expect(result.map((m) => m.url)).toEqual([
      'https://cdn.example.com/a.pdf',
      'https://cdn.example.com/b.pdf',
    ]);
  });

  it('resolves embedUrl independently per entry', () => {
    const result = classifyMediaParameter({
      name: 'VideoURL',
      value:
        'https://www.youtube.com/watch?v=abc123|https://cdn.example.com/clip.mp4',
    });
    expect(result[0]?.embedUrl).toBe('https://www.youtube.com/embed/abc123');
    // A direct file has no embed URL — callers render it with <video>.
    expect(result[1]?.embedUrl).toBeNull();
  });

  it('gives every entry from one parameter the same label', () => {
    const result = classifyMediaParameter({
      name: 'ProductSpec',
      value: 'https://cdn.example.com/a.pdf|https://cdn.example.com/b.pdf',
    });
    expect(result.map((m) => m.label)).toEqual([
      'Product Spec',
      'Product Spec',
    ]);
  });
});

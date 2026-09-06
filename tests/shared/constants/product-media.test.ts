import { describe, it, expect } from 'vitest';
import {
  classifyMediaParameter,
  PRODUCT_MEDIA_PARAMETER_DEFAULTS,
} from '../../../shared/constants/product-media';

describe('classifyMediaParameter', () => {
  it('keys on identifier, so a localized display name still classifies', () => {
    // `name` is the display string and changes per language; `identifier` is
    // documented by Geins as the same across every language. Classifying on
    // the name would work in the default locale and stop in all the others.
    const result = classifyMediaParameter({
      identifier: 'videourl',
      name: 'Produktvideo',
      value: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result?.kind).toBe('video');
  });

  it('falls back to name when the parameter carries no identifier', () => {
    const result = classifyMediaParameter({
      name: 'VideoURL',
      value: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result?.kind).toBe('video');
  });

  it('matches a tenant table key whatever case the merchant typed it in', () => {
    // The merchant admin stores the key verbatim, so the documented
    // `{"Datasheet": "document"}` has to match a `datasheet` parameter.
    const result = classifyMediaParameter(
      { identifier: 'datasheet', value: 'https://cdn.example.com/d.pdf' },
      { Datasheet: 'document' },
    );
    expect(result?.kind).toBe('document');
  });

  it('lets a mixed-case tenant override replace the default for that key', () => {
    // `Manual` and `manual` must be the same entry, not two.
    const result = classifyMediaParameter(
      { identifier: 'manual', value: 'https://cdn.example.com/m.mp4' },
      { ...PRODUCT_MEDIA_PARAMETER_DEFAULTS, Manual: 'video' },
    );
    expect(result?.kind).toBe('video');
  });

  it('classifies a known name against the default table when no table is passed', () => {
    const result = classifyMediaParameter({
      name: 'VideoURL',
      value: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result?.kind).toBe('video');
  });

  it("uses a tenant's own table instead of the defaults when one is passed", () => {
    const tenantTable = { producturl: 'video' as const };

    // "VideoURL" isn't in this tenant's table, so the default match doesn't apply.
    expect(
      classifyMediaParameter(
        { name: 'VideoURL', value: 'https://cdn.example.com/vid.mp4' },
        tenantTable,
      ),
    ).toBeNull();

    // "ProductURL" is this tenant's own name for the same concept.
    const result = classifyMediaParameter(
      { name: 'ProductURL', value: 'https://cdn.example.com/vid.mp4' },
      tenantTable,
    );
    expect(result?.kind).toBe('video');
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
    expect(extended?.kind).toBe('document');

    // The defaults this tenant didn't override still work.
    const stillDefault = classifyMediaParameter(
      { name: 'Manual', value: 'https://cdn.example.com/manual.pdf' },
      tenantTable,
    );
    expect(stillDefault?.kind).toBe('document');
  });

  it('still requires a URL-shaped value even with a custom table', () => {
    const tenantTable = { datasheet: 'document' as const };
    const result = classifyMediaParameter(
      { name: 'Datasheet', value: 'Contact sales for the datasheet' },
      tenantTable,
    );
    expect(result).toBeNull();
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
    expect(result).toBeNull();
  });
});

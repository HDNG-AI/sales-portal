import { describe, it, expect } from 'vitest';
import {
  META_DESCRIPTION_MAX,
  firstMetaDescription,
  metaDescription,
} from '../../../shared/utils/meta-description';

describe('metaDescription', () => {
  it('strips tags and collapses whitespace', () => {
    expect(
      metaDescription(
        '<p>Brittiska  Actisense</p>\n<ul><li>NMEA 2000</li></ul>',
      ),
    ).toBe('Brittiska Actisense NMEA 2000');
  });

  it('decodes the entities merchant editors produce', () => {
    expect(
      metaDescription(
        '12&nbsp;V &amp; 24&#160;V &lt;100 A&gt; &quot;Lite&quot; &#39;x&#39;',
      ),
    ).toBe('12 V & 24 V <100 A> "Lite" \'x\'');
  });

  it('returns an empty string for missing or tag-only input', () => {
    expect(metaDescription(undefined)).toBe('');
    expect(metaDescription(null)).toBe('');
    expect(metaDescription('<p><br></p>')).toBe('');
  });

  it('keeps text that fits unchanged', () => {
    const text = 'a'.repeat(META_DESCRIPTION_MAX);
    expect(metaDescription(text)).toBe(text);
  });

  it('cuts long text at a word boundary and marks the cut', () => {
    const text = `${'ord '.repeat(60)}slut`;
    const out = metaDescription(text);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(
      out
        .slice(0, -1)
        .split(' ')
        .every((w) => w === 'ord'),
    ).toBe(true);
  });

  it('cuts a single overlong word at the limit', () => {
    const out = metaDescription('x'.repeat(300), 20);
    expect(out).toBe(`${'x'.repeat(19)}…`);
  });
});

describe('firstMetaDescription', () => {
  it('uses the first candidate with visible text', () => {
    expect(
      firstMetaDescription('', '<p> </p>', '<p>Lång text</p>', 'sist'),
    ).toBe('Lång text');
  });

  it('returns an empty string when no candidate has text', () => {
    expect(firstMetaDescription(undefined, null, '')).toBe('');
  });
});

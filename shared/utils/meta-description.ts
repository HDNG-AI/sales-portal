/**
 * Meta descriptions from merchant HTML.
 *
 * Product, category and brand texts arrive as editor HTML. A description meta
 * tag needs plain text of a length search engines show in full, cut where a
 * word ends rather than mid-word.
 */
export const META_DESCRIPTION_MAX = 160;

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      if (value === 160) return ' ';
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Plain text of `html`, at most `max` characters, cut at a word boundary. */
export function metaDescription(
  html: string | null | undefined,
  max = META_DESCRIPTION_MAX,
): string {
  if (!html) return '';
  const text = decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s,;:.–-]+$/, '')}…`;
}

/** The description of the first candidate that has visible text. */
export function firstMetaDescription(
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    const text = metaDescription(candidate);
    if (text) return text;
  }
  return '';
}

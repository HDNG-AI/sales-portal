import { posix } from 'node:path';
import { listZipEntries, readZipEntry, ZipReadError } from './zip';
import type { SheetCell, SheetReadResult, SheetRow } from './sheet';
import { SHEET_MAX_COLUMNS, isBlankSheetRow } from './sheet';

/**
 * Reads the first visible worksheet of an .xlsx workbook as cell text.
 *
 * Only cached values are read; a formula is never evaluated, and one with no
 * cached value reads as empty. Numbers are given back as their exact stored
 * digits rather than Excel's display text, which would turn a long article
 * number into scientific notation. A zero-padding number format such as
 * `000000` is applied, so leading zeros the buyer sees in Excel survive.
 *
 * SpreadsheetML is regular, machine-written XML, so the parts are read by
 * scanning for tags rather than through a DOM; element names may carry a
 * namespace prefix. Every scan only moves forward, so reading a part takes
 * time in proportion to its size, and an element that is never closed makes
 * the workbook unreadable.
 */

/**
 * Ceiling for all inflated parts together. An order file needs a small
 * fraction of it; the ceiling bounds the memory and time one upload can cost.
 */
export const XLSX_MAX_INFLATED_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling for each part that describes the workbook rather than holding its
 * cells: the relationships, the workbook part and the styles.
 */
export const XLSX_MAX_STRUCTURE_PART_BYTES = 1024 * 1024;

/**
 * A start tag named one of `names`, behind an optional namespace prefix.
 * Captures the qualified name, the local name and the attribute text (with
 * the `/` of a self-closing tag). It cannot match across a `<`, so a search
 * for it never runs on through the rest of the part.
 */
function startTag(names: string): RegExp {
  return new RegExp(`<((?:[\\w.-]+:)?(${names}))(?=[\\s/>])([^<>]*)>`, 'g');
}

const ROW = startTag('row');
const CELL = startTag('c');
const VALUE = startTag('v');
const INLINE_STRING = startTag('is');
const SHARED_STRING = startTag('si');
/** Text runs, and the phonetic runs whose text is left out. */
const TEXT = startTag('t|rPh');
const RELATIONSHIP = startTag('Relationship');
const SHEET = startTag('sheet');
const NUMBER_FORMAT = startTag('numFmt');
const CELL_FORMATS = startTag('cellXfs');
const CELL_FORMAT = startTag('xf');

interface XmlElement {
  /** Local name, without a namespace prefix. */
  name: string;
  attributes: string;
  /** Everything between the start and end tag; empty when self-closing. */
  inner: string;
}

/**
 * The elements `tag` matches, in document order, without looking inside one
 * for more. Each end tag is found with `indexOf` from its start tag on, so
 * the scan never goes back; an element with no end tag throws rather than
 * being searched for again from every later start tag.
 */
function* elements(xml: string, tag: RegExp): Generator<XmlElement> {
  let position = 0;
  for (;;) {
    // Set before every search: another scan with the same pattern may have
    // run while this one was suspended.
    tag.lastIndex = position;
    const match = tag.exec(xml);
    if (!match) return;
    const [, qualifiedName = '', name = '', rawAttributes = ''] = match;
    const contentStart = tag.lastIndex;
    if (rawAttributes.endsWith('/')) {
      position = contentStart;
      yield { name, attributes: rawAttributes.slice(0, -1), inner: '' };
      continue;
    }
    const endTag = `</${qualifiedName}>`;
    const end = xml.indexOf(endTag, contentStart);
    if (end < 0) throw new ZipReadError(`Unclosed <${qualifiedName}> element`);
    position = end + endTag.length;
    yield {
      name,
      attributes: rawAttributes,
      inner: xml.slice(contentStart, end),
    };
  }
}

function firstElement(xml: string, tag: RegExp): XmlElement | undefined {
  for (const element of elements(xml, tag)) return element;
  return undefined;
}

/** Attribute text of every start tag `tag` matches, whatever follows it. */
function* startTags(xml: string, tag: RegExp): Generator<string> {
  let position = 0;
  for (;;) {
    tag.lastIndex = position;
    const match = tag.exec(xml);
    if (!match) return;
    position = tag.lastIndex;
    yield (match[3] ?? '').replace(/\/$/, '');
  }
}

/** Built-in number formats that render a date or time. */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

interface CellFormat {
  /** Width of a pure zero-padding format (`000000`), else 0. */
  padWidth: number;
  isDate: boolean;
}

function decodeXml(text: string): string {
  // Most values have nothing to decode; spare them both passes.
  if (!text.includes('&') && !text.includes('_x')) return text;
  return text
    .replace(
      /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
      (_match, entity: string) => {
        switch (entity) {
          case 'lt':
            return '<';
          case 'gt':
            return '>';
          case 'amp':
            return '&';
          case 'quot':
            return '"';
          case 'apos':
            return "'";
        }
        const code =
          entity[1] === 'x'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      },
    )
    .replace(/_x([0-9a-fA-F]{4})_/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/** Compiled once per name, not per call: a sheet can hold millions of cells. */
const ATTRIBUTE_PATTERNS = new Map<string, RegExp>();

function attribute(attributes: string, name: string): string | undefined {
  let pattern = ATTRIBUTE_PATTERNS.get(name);
  if (!pattern) {
    pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    ATTRIBUTE_PATTERNS.set(name, pattern);
  }
  const match = pattern.exec(attributes);
  return match ? decodeXml(match[1] ?? match[2] ?? '') : undefined;
}

/** `r:id`, whatever prefix the relationships namespace was given. */
function relationshipId(attributes: string): string | undefined {
  return /\s[\w.-]+:id\s*=\s*"([^"]*)"/.exec(attributes)?.[1];
}

function textOf(fragment: string): string {
  let text = '';
  for (const run of elements(fragment, TEXT)) {
    if (run.name === 't') text += decodeXml(run.inner);
  }
  return text;
}

function columnIndex(reference: string | undefined): number | undefined {
  const letters = /^([A-Za-z]{1,3})\d*$/.exec(reference ?? '')?.[1];
  if (!letters) return undefined;
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function partPath(base: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  return posix.normalize(posix.join(posix.dirname(base), target));
}

function relationshipsPath(part: string): string {
  return posix.join(
    posix.dirname(part),
    '_rels',
    `${posix.basename(part)}.rels`,
  );
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function readRelationships(xml: string | null): Relationship[] {
  if (!xml) return [];
  return Array.from(startTags(xml, RELATIONSHIP), (attributes) => ({
    id: attribute(attributes, 'Id') ?? '',
    type: attribute(attributes, 'Type') ?? '',
    target: attribute(attributes, 'Target') ?? '',
  }));
}

// A bracketed section stops at the next `[` as well as at its `]`, so a run
// of unclosed brackets is passed over once rather than once per bracket.
function isDateFormatCode(code: string): boolean {
  const unquoted = code.replace(/"[^"]*"|\[[^[\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(unquoted);
}

function zeroPadWidth(code: string): number {
  const section = (code.split(';')[0] ?? '').replace(/\[[^[\]]*\]/g, '').trim();
  return /^0+$/.test(section) ? section.length : 0;
}

function readCellFormats(xml: string | null): CellFormat[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const attributes of startTags(xml, NUMBER_FORMAT)) {
    const id = Number(attribute(attributes, 'numFmtId'));
    const code = attribute(attributes, 'formatCode');
    if (Number.isInteger(id) && code !== undefined) custom.set(id, code);
  }
  const section = firstElement(xml, CELL_FORMATS)?.inner ?? '';
  return Array.from(startTags(section, CELL_FORMAT), (attributes) => {
    const id = Number(attribute(attributes, 'numFmtId') ?? 0);
    const code = custom.get(id);
    if (code === undefined) {
      return { padWidth: 0, isDate: BUILTIN_DATE_FORMATS.has(id) };
    }
    return { padWidth: zeroPadWidth(code), isDate: isDateFormatCode(code) };
  });
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return Array.from(elements(xml, SHARED_STRING), (item) => textOf(item.inner));
}

/**
 * A numeric cell as text. Excel keeps 15 significant digits, so a longer
 * integer no longer holds what was typed; neither does a date.
 */
function numberText(raw: string, format: CellFormat | undefined): SheetCell {
  const value = raw.trim();
  if (!value) return { text: '' };
  let text = value;
  if (!/^-?\d+$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number) && Number.isInteger(number)) {
      text = BigInt(number).toString();
    }
  }
  const digits = text.replace(/^-/, '').replace(/^0+(?=\d)/, '');
  const altered =
    (/^\d+$/.test(digits) && digits.length > 15) || !!format?.isDate;
  const width = format?.padWidth ?? 0;
  if (width && /^\d+$/.test(text) && text.length < width) {
    text = text.padStart(width, '0');
  }
  return altered ? { text, altered } : { text };
}

function cellValue(
  attributes: string,
  inner: string,
  sharedStrings: string[],
  formats: CellFormat[],
): SheetCell {
  const type = attribute(attributes, 't') ?? 'n';
  const value = decodeXml(firstElement(inner, VALUE)?.inner ?? '');
  switch (type) {
    case 's': {
      // No value is an empty cell, not shared string 0.
      const index = value.trim();
      return {
        text: /^\d+$/.test(index) ? (sharedStrings[Number(index)] ?? '') : '',
      };
    }
    case 'inlineStr':
      return { text: textOf(firstElement(inner, INLINE_STRING)?.inner ?? '') };
    case 'str':
      return { text: value };
    case 'b':
      return { text: value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value };
    case 'e':
      return { text: '' };
    case 'd':
      return { text: value, altered: true };
    default: {
      const style = Number(attribute(attributes, 's') ?? 0);
      return numberText(value, formats[Number.isInteger(style) ? style : 0]);
    }
  }
}

export function readFirstWorksheet(
  content: Buffer,
  maxRows: number,
): SheetReadResult {
  const entries = listZipEntries(content);
  let budget = XLSX_MAX_INFLATED_BYTES;
  /** A part, within its own ceiling and what is left of the budget. */
  const read = (name: string, ceiling: number): string | null => {
    const entry = entries.get(name);
    if (!entry) return null;
    const data = readZipEntry(content, entry, Math.min(ceiling, budget));
    budget -= data.length;
    return data.toString('utf8').replace(/^\uFEFF/, '');
  };
  const readStructure = (name: string) =>
    read(name, XLSX_MAX_STRUCTURE_PART_BYTES);

  const officeDocument = readRelationships(readStructure('_rels/.rels')).find(
    (rel) => rel.type.endsWith('/officeDocument'),
  );
  const workbookPath = officeDocument
    ? partPath('', officeDocument.target)
    : 'xl/workbook.xml';
  const workbook = readStructure(workbookPath);
  if (!workbook) throw new ZipReadError('No workbook part');

  const workbookRelationships = readRelationships(
    readStructure(relationshipsPath(workbookPath)),
  );
  const related = (suffix: string, fallback: string): string => {
    const rel = workbookRelationships.find((r) => r.type.endsWith(suffix));
    return rel ? partPath(workbookPath, rel.target) : fallback;
  };

  // A hidden sheet is usually a lookup list; the buyer means the first one
  // Excel shows. With every sheet hidden, the first one is all there is.
  const sheets = Array.from(startTags(workbook, SHEET));
  const firstSheet =
    sheets.find((sheet) => {
      const state = attribute(sheet, 'state');
      return state === undefined || state === 'visible';
    }) ?? sheets[0];
  const sheetId = firstSheet ? relationshipId(firstSheet) : undefined;
  const sheetRelationship = workbookRelationships.find((r) => r.id === sheetId);
  const sheetPath = sheetRelationship
    ? partPath(workbookPath, sheetRelationship.target)
    : 'xl/worksheets/sheet1.xml';
  const sheet = read(sheetPath, XLSX_MAX_INFLATED_BYTES);
  if (!sheet) throw new ZipReadError('No worksheet part');

  const sharedStrings = readSharedStrings(
    read(
      related('/sharedStrings', 'xl/sharedStrings.xml'),
      XLSX_MAX_INFLATED_BYTES,
    ),
  );
  const formats = readCellFormats(
    readStructure(related('/styles', 'xl/styles.xml')),
  );

  const rows: SheetRow[] = [];
  let truncated = false;
  let previousRow = 0;
  for (const row of elements(sheet, ROW)) {
    const rowNumber = Number(attribute(row.attributes, 'r')) || previousRow + 1;
    previousRow = rowNumber;

    const cells: SheetCell[] = [];
    let previousColumn = -1;
    for (const cell of elements(row.inner, CELL)) {
      const column =
        columnIndex(attribute(cell.attributes, 'r')) ?? previousColumn + 1;
      previousColumn = column;
      if (column >= SHEET_MAX_COLUMNS) continue;
      while (cells.length < column) cells.push({ text: '' });
      cells[column] = cellValue(
        cell.attributes,
        cell.inner,
        sharedStrings,
        formats,
      );
    }

    if (isBlankSheetRow(cells)) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push({ rowNumber, cells });
  }
  return { rows, truncated };
}

import { posix } from 'node:path';
import { listZipEntries, readZipEntry, ZipReadError } from './zip';
import type { SheetCell, SheetReadResult, SheetRow } from './sheet';
import { SHEET_MAX_COLUMNS, isBlankSheetRow } from './sheet';

/**
 * Reads the first worksheet of an .xlsx workbook as cell text.
 *
 * Only cached values are read; a formula is never evaluated, and one with no
 * cached value reads as empty. Numbers are given back as their exact stored
 * digits rather than Excel's display text, which would turn a long article
 * number into scientific notation. A zero-padding number format such as
 * `000000` is applied, so leading zeros the buyer sees in Excel survive.
 *
 * SpreadsheetML is regular, machine-written XML, so the parts are read with
 * patterns rather than a DOM; element names may carry a namespace prefix.
 */

/** Ceiling for any one inflated part of the workbook. */
const MAX_PART_BYTES = 32 * 1024 * 1024;

/** An optional namespace prefix in front of an element name. */
const NS = '(?:[\\w.-]+:)?';

const ROW = new RegExp(
  `<${NS}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}row>)`,
  'g',
);
const CELL = new RegExp(`<${NS}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, 'g');
const VALUE = new RegExp(`<${NS}v(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${NS}v>`);
const INLINE_STRING = new RegExp(`<${NS}is\\b[^>]*>([\\s\\S]*?)</${NS}is>`);
const SHARED_STRING = new RegExp(
  `<${NS}si\\b[^>]*?(?:/>|>([\\s\\S]*?)</${NS}si>)`,
  'g',
);
const TEXT = new RegExp(
  `<${NS}t(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${NS}t>`,
  'g',
);
const PHONETIC = new RegExp(`<${NS}rPh\\b[\\s\\S]*?</${NS}rPh>`, 'g');
const RELATIONSHIP = new RegExp(`<${NS}Relationship\\b([^>]*?)/?>`, 'g');
const FIRST_SHEET = new RegExp(`<${NS}sheet\\b([^>]*?)/?>`);
const NUMBER_FORMAT = new RegExp(`<${NS}numFmt\\b([^>]*?)/?>`, 'g');
const CELL_FORMATS = new RegExp(
  `<${NS}cellXfs\\b[^>]*>([\\s\\S]*?)</${NS}cellXfs>`,
);
const CELL_FORMAT = new RegExp(`<${NS}xf\\b([^>]*?)/?>`, 'g');

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

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
  ).exec(attributes);
  return match ? decodeXml(match[1] ?? match[2] ?? '') : undefined;
}

/** `r:id`, whatever prefix the relationships namespace was given. */
function relationshipId(attributes: string): string | undefined {
  return /\s[\w.-]+:id\s*=\s*"([^"]*)"/.exec(attributes)?.[1];
}

function textOf(fragment: string): string {
  let text = '';
  for (const match of fragment.replace(PHONETIC, '').matchAll(TEXT)) {
    text += decodeXml(match[1] ?? '');
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
  return [...xml.matchAll(RELATIONSHIP)].map((match) => ({
    id: attribute(match[1] ?? '', 'Id') ?? '',
    type: attribute(match[1] ?? '', 'Type') ?? '',
    target: attribute(match[1] ?? '', 'Target') ?? '',
  }));
}

function isDateFormatCode(code: string): boolean {
  const unquoted = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(unquoted);
}

function zeroPadWidth(code: string): number {
  const section = (code.split(';')[0] ?? '').replace(/\[[^\]]*\]/g, '').trim();
  return /^0+$/.test(section) ? section.length : 0;
}

function readCellFormats(xml: string | null): CellFormat[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(NUMBER_FORMAT)) {
    const id = Number(attribute(match[1] ?? '', 'numFmtId'));
    const code = attribute(match[1] ?? '', 'formatCode');
    if (Number.isInteger(id) && code !== undefined) custom.set(id, code);
  }
  const section = CELL_FORMATS.exec(xml)?.[1] ?? '';
  return [...section.matchAll(CELL_FORMAT)].map((match) => {
    const id = Number(attribute(match[1] ?? '', 'numFmtId') ?? 0);
    const code = custom.get(id);
    if (code === undefined) {
      return { padWidth: 0, isDate: BUILTIN_DATE_FORMATS.has(id) };
    }
    return { padWidth: zeroPadWidth(code), isDate: isDateFormatCode(code) };
  });
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(SHARED_STRING)].map((match) =>
    textOf(match[1] ?? ''),
  );
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
  const value = decodeXml(VALUE.exec(inner)?.[1] ?? '');
  switch (type) {
    case 's': {
      const index = Number(value);
      return {
        text: Number.isInteger(index) ? (sharedStrings[index] ?? '') : '',
      };
    }
    case 'inlineStr':
      return { text: textOf(INLINE_STRING.exec(inner)?.[1] ?? '') };
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
  const read = (name: string): string | null => {
    const entry = entries.get(name);
    if (!entry) return null;
    return readZipEntry(content, entry, MAX_PART_BYTES)
      .toString('utf8')
      .replace(/^\uFEFF/, '');
  };

  const officeDocument = readRelationships(read('_rels/.rels')).find((rel) =>
    rel.type.endsWith('/officeDocument'),
  );
  const workbookPath = officeDocument
    ? partPath('', officeDocument.target)
    : 'xl/workbook.xml';
  const workbook = read(workbookPath);
  if (!workbook) throw new ZipReadError('No workbook part');

  const workbookRelationships = readRelationships(
    read(relationshipsPath(workbookPath)),
  );
  const related = (suffix: string, fallback: string): string => {
    const rel = workbookRelationships.find((r) => r.type.endsWith(suffix));
    return rel ? partPath(workbookPath, rel.target) : fallback;
  };

  const firstSheet = FIRST_SHEET.exec(workbook);
  const sheetId = firstSheet ? relationshipId(firstSheet[1] ?? '') : undefined;
  const sheetRelationship = workbookRelationships.find((r) => r.id === sheetId);
  const sheetPath = sheetRelationship
    ? partPath(workbookPath, sheetRelationship.target)
    : 'xl/worksheets/sheet1.xml';
  const sheet = read(sheetPath);
  if (!sheet) throw new ZipReadError('No worksheet part');

  const sharedStrings = readSharedStrings(
    read(related('/sharedStrings', 'xl/sharedStrings.xml')),
  );
  const formats = readCellFormats(read(related('/styles', 'xl/styles.xml')));

  const rows: SheetRow[] = [];
  let truncated = false;
  let previousRow = 0;
  for (const rowMatch of sheet.matchAll(ROW)) {
    const rowNumber =
      Number(attribute(rowMatch[1] ?? '', 'r')) || previousRow + 1;
    previousRow = rowNumber;

    const cells: SheetCell[] = [];
    let previousColumn = -1;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(CELL)) {
      const attributes = cellMatch[1] ?? '';
      const column =
        columnIndex(attribute(attributes, 'r')) ?? previousColumn + 1;
      previousColumn = column;
      if (column >= SHEET_MAX_COLUMNS) continue;
      while (cells.length < column) cells.push({ text: '' });
      cells[column] = cellValue(
        attributes,
        cellMatch[2] ?? '',
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

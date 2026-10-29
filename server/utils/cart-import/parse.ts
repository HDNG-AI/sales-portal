import {
  CART_IMPORT_MAX_FILE_BYTES,
  CART_IMPORT_MAX_QUANTITY,
  CART_IMPORT_MAX_ROWS,
} from '#shared/constants/cart-import';
import type {
  CartImportColumns,
  CartImportFileError,
  CartImportProblem,
} from '#shared/types/cart-import';
import { decodeCsvText, readDelimitedRows } from './csv';
import type { SheetReadResult, SheetRow } from './sheet';
import { readFirstWorksheet } from './xlsx';
import { isZipArchive } from './zip';

/**
 * Turns an uploaded order file (.xlsx or CSV) into article numbers and
 * quantities. Nothing here talks to Geins: the result says what the file
 * asks for and which rows cannot be read, with the row numbers the buyer sees
 * in Excel.
 */

/** Header names, compared after `normalizeOrderHeading`. */
const ARTICLE_HEADERS = new Set([
  'artikelnummer',
  'artikelnr',
  'artnr',
  'artno',
  'sku',
  'articlenumber',
  'articleno',
  'itemnumber',
  'itemno',
  'produktnummer',
  'produktnr',
  'varenummer',
  'varenr',
  'artikkelnummer',
  'tuotenumero',
]);

const QUANTITY_HEADERS = new Set([
  'antal',
  'antall',
  'qty',
  'quantity',
  'kvantitet',
  'menge',
  'anzahl',
  'maara',
]);

/** Rows searched for a heading row; rows above it (order details) are ignored. */
const HEADER_SCAN_ROWS = 20;
/** Non-blank rows a reader collects before giving up on the file. */
const READ_LIMIT = CART_IMPORT_MAX_ROWS * 10;

const EXTENSIONS = new Set(['xlsx', 'xls', 'csv']);
const OLE_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
/** How a long number reads after Excel has shortened it ("1,23457E+13"). */
const SCIENTIFIC = /^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

export interface OrderFileEntry {
  /** As written in the file, first occurrence. */
  articleNumber: string;
  /** Summed over every row with the same article number. */
  quantity: number;
  rows: number[];
}

export type ParsedOrderFile =
  | { ok: false; error: CartImportFileError }
  | {
      ok: true;
      format: 'xlsx' | 'csv';
      columns: CartImportColumns;
      entries: OrderFileEntry[];
      problems: CartImportProblem[];
    };

/** "Art.nr" → "artnr", "Määrä" → "maara". */
export function normalizeOrderHeading(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Article numbers that differ only in case are the same article. */
export function articleNumberKey(articleNumber: string): string {
  return articleNumber.trim().toUpperCase();
}

function clean(text: string | undefined): string {
  return (text ?? '').replace(INVISIBLE, '').trim();
}

/**
 * A positive whole number. Digits only, optionally grouped in threes by
 * spaces ("1 000"); a comma or point is refused rather than guessed at,
 * since "1,000" means a thousand to some buyers and one to others.
 */
export function parseOrderQuantity(text: string): number | null {
  const value = text.trim();
  if (
    !/^\d+$/.test(value) &&
    !/^\d{1,3}(?:[\s\u00a0\u202f]\d{3})+$/.test(value)
  ) {
    return null;
  }
  const quantity = Number(value.replace(/\D/g, ''));
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function readSheet(
  content: Buffer,
  extension: string,
): { format: 'xlsx' | 'csv'; sheet: SheetReadResult } | CartImportFileError {
  if (isZipArchive(content)) {
    try {
      return { format: 'xlsx', sheet: readFirstWorksheet(content, READ_LIMIT) };
    } catch {
      return 'unreadable';
    }
  }
  if (content.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE)) {
    return 'legacy_excel';
  }
  if (extension === 'xlsx') return 'unreadable';
  const utf16 =
    (content[0] === 0xff && content[1] === 0xfe) ||
    (content[0] === 0xfe && content[1] === 0xff);
  if (!utf16 && content.includes(0)) return 'unsupported_format';
  return {
    format: 'csv',
    sheet: readDelimitedRows(decodeCsvText(content), READ_LIMIT),
  };
}

function findColumns(
  rows: SheetRow[],
): CartImportColumns | CartImportFileError {
  for (const row of rows.slice(0, HEADER_SCAN_ROWS)) {
    const names = row.cells.map((cell) => normalizeOrderHeading(cell.text));
    const article = names.findIndex((name) => ARTICLE_HEADERS.has(name));
    const quantity = names.findIndex((name) => QUANTITY_HEADERS.has(name));
    if (article < 0 && quantity < 0) continue;
    if (article < 0) return 'missing_article_column';
    if (quantity < 0) return 'missing_quantity_column';
    return {
      article,
      quantity,
      headerRow: row.rowNumber,
      headerRecognized: true,
    };
  }
  // No heading we know: column A is the article number, column B the
  // quantity. A first row whose B cell has no digit at all is a heading in
  // words we do not recognise, not an order line.
  const first = rows[0];
  const second = clean(first?.cells[1]?.text);
  const unknownHeading = !!first && !!second && !/\d/.test(second);
  return {
    article: 0,
    quantity: 1,
    headerRow: unknownHeading ? first.rowNumber : null,
    headerRecognized: false,
  };
}

export function parseOrderFile(
  content: Buffer,
  fileName: string,
): ParsedOrderFile {
  if (content.length === 0) return { ok: false, error: 'empty_file' };
  if (content.length > CART_IMPORT_MAX_FILE_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  const extension =
    /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase() ?? '';
  if (!EXTENSIONS.has(extension)) {
    return { ok: false, error: 'unsupported_format' };
  }

  const read = readSheet(content, extension);
  if (typeof read === 'string') return { ok: false, error: read };
  const { format, sheet } = read;
  if (sheet.truncated) return { ok: false, error: 'too_many_rows' };

  const columns = findColumns(sheet.rows);
  if (typeof columns === 'string') return { ok: false, error: columns };

  const entries = new Map<string, OrderFileEntry>();
  const problems: CartImportProblem[] = [];
  let dataRows = 0;

  for (const row of sheet.rows) {
    if (columns.headerRow !== null && row.rowNumber <= columns.headerRow) {
      continue;
    }
    const articleCell = row.cells[columns.article];
    const article = clean(articleCell?.text);
    const quantityText = clean(row.cells[columns.quantity]?.text);
    if (!article && !quantityText) continue;

    dataRows += 1;
    if (dataRows > CART_IMPORT_MAX_ROWS) {
      return { ok: false, error: 'too_many_rows' };
    }

    const rows = [row.rowNumber];
    if (!article) {
      problems.push({
        reason: 'missing_article_number',
        rows,
        articleNumber: '',
        quantity: quantityText,
      });
      continue;
    }
    if (articleCell?.altered || SCIENTIFIC.test(article)) {
      problems.push({
        reason: 'article_number_altered',
        rows,
        articleNumber: article,
      });
      continue;
    }
    const quantity = parseOrderQuantity(quantityText);
    if (quantity === null) {
      problems.push({
        reason: 'invalid_quantity',
        rows,
        articleNumber: article,
        quantity: quantityText,
      });
      continue;
    }

    const key = articleNumberKey(article);
    const entry = entries.get(key);
    if (entry) {
      entry.quantity += quantity;
      entry.rows.push(row.rowNumber);
    } else {
      entries.set(key, { articleNumber: article, quantity, rows });
    }
  }

  if (dataRows === 0) return { ok: false, error: 'no_rows' };

  const accepted: OrderFileEntry[] = [];
  for (const entry of entries.values()) {
    if (entry.quantity > CART_IMPORT_MAX_QUANTITY) {
      problems.push({
        reason: 'quantity_too_large',
        rows: entry.rows,
        articleNumber: entry.articleNumber,
        quantity: String(entry.quantity),
      });
    } else {
      accepted.push(entry);
    }
  }
  problems.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));

  return { ok: true, format, columns, entries: accepted, problems };
}

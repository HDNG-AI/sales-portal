import type { SheetReadResult, SheetRow } from './sheet';
import { SHEET_MAX_COLUMNS, isBlankSheetRow } from './sheet';

/**
 * Decode CSV bytes. A byte-order mark decides when there is one; otherwise
 * the bytes are UTF-8 if they decode as UTF-8 and Windows-1252 if not, which
 * is what Excel writes for "CSV (semicolon separated)" on a Swedish system.
 */
export function decodeCsvText(content: Buffer): string {
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(content.subarray(3));
  }
  if (content[0] === 0xff && content[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(content.subarray(2));
  }
  if (content[0] === 0xfe && content[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(content.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return new TextDecoder('windows-1252').decode(content);
  }
}

/** Candidates in tie-break order: the Nordic Excel default first. */
const DELIMITERS = [';', '\t', ','] as const;
const SAMPLE_LINES = 10;

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) count += 1;
  }
  return count;
}

/**
 * The delimiter that splits the most sample lines into the same number of
 * fields. A metadata line above the table ("Customer: A, B") does not throw
 * it, because one odd line cannot outvote the table's rows.
 */
function detectDelimiter(text: string): string {
  const sample = text
    .split(/\r\n|\n|\r/, 50)
    .filter((line) => line.trim())
    .slice(0, SAMPLE_LINES);
  let best: string = DELIMITERS[0];
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = sample
      .map((line) => countOutsideQuotes(line, delimiter))
      .filter((count) => count > 0);
    if (!counts.length) continue;
    const frequency = new Map<number, number>();
    for (const count of counts) {
      frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
    const score = Math.max(...frequency.values());
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Split CSV text into rows. Quoted fields may hold delimiters, doubled quotes
 * and line breaks. A first line of `sep=;` (Excel's own hint) sets the
 * delimiter and is not a row. Blank rows are dropped but still counted, so
 * row numbers match what Excel shows.
 */
export function readDelimitedRows(
  text: string,
  maxRows: number,
): SheetReadResult {
  let body = text.replace(/^\uFEFF/, '');
  let delimiter: string | undefined;
  const hint = /^sep=(.)(?:\r\n|\n|\r|$)/i.exec(body);
  if (hint) {
    delimiter = hint[1];
    body = body.slice(hint[0].length);
  }
  delimiter ??= detectDelimiter(body);

  const rows: SheetRow[] = [];
  let truncated = false;
  let cells: string[] = [];
  let field = '';
  /**
   * Whether `field` holds more than whitespace, kept as characters arrive
   * rather than by trimming the field at every quote, which takes quadratic
   * time on a long line of quotes.
   */
  let fieldHasContent = false;
  let inQuotes = false;
  let fieldQuoted = false;
  let rowNumber = 0;

  const endField = () => {
    if (cells.length < SHEET_MAX_COLUMNS) cells.push(field);
    field = '';
    fieldHasContent = false;
    fieldQuoted = false;
  };
  /** False once the limit is passed and reading should stop. */
  const endRow = (): boolean => {
    endField();
    rowNumber += 1;
    const row: SheetRow = { rowNumber, cells: cells.map((text) => ({ text })) };
    cells = [];
    if (isBlankSheetRow(row.cells)) return true;
    if (rows.length >= maxRows) {
      truncated = true;
      return false;
    }
    rows.push(row);
    return true;
  };

  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (body[index + 1] === '"') {
        field += '"';
        index += 1;
      } else inQuotes = false;
    } else if (char === '"' && !fieldQuoted && !fieldHasContent) {
      field = '';
      inQuotes = true;
      fieldQuoted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[index + 1] === '\n') index += 1;
      if (!endRow()) break;
    } else {
      field += char;
      if (char.trim()) fieldHasContent = true;
    }
  }
  if (!truncated && (field || cells.length || fieldQuoted)) endRow();

  return { rows, truncated };
}

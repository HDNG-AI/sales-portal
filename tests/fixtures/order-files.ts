import { deflateRawSync } from 'node:zlib';

/**
 * Builders for order files the cart import reads. Workbooks are assembled
 * from the same parts Excel writes (content types, relationships, workbook,
 * worksheet, shared strings, styles), so a test can state the one cell detail
 * it cares about and still hand the parser a real .xlsx archive.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP archive of the given entries, deflated unless `store` is set.
 * `declaredSizes` writes another uncompressed size into an entry's headers
 * than the true one, as a hostile archive can.
 */
export function buildZip(
  files: Record<string, string | Buffer>,
  options: { store?: boolean; declaredSizes?: Record<string, number> } = {},
): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, 'utf8');
    const packed = options.store ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const method = options.store ? 0 : 8;
    const size = options.declaredSizes?.[name] ?? data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One `<c>` element. `raw` is the stored `<v>`; `text` an inline string. */
export interface XlsxCell {
  ref: string;
  type?: 's' | 'n' | 'str' | 'inlineStr' | 'b' | 'e' | 'd';
  raw?: string;
  text?: string;
  style?: number;
  formula?: string;
}

export function cellXml(cell: XlsxCell): string {
  const attributes = [`r="${cell.ref}"`];
  if (cell.type && cell.type !== 'n') attributes.push(`t="${cell.type}"`);
  if (cell.style !== undefined) attributes.push(`s="${cell.style}"`);
  const formula = cell.formula ? `<f>${escapeXml(cell.formula)}</f>` : '';
  if (cell.type === 'inlineStr') {
    return `<c ${attributes.join(' ')}><is><t>${escapeXml(cell.text ?? '')}</t></is></c>`;
  }
  const value = cell.raw === undefined ? '' : `<v>${escapeXml(cell.raw)}</v>`;
  return `<c ${attributes.join(' ')}>${formula}${value}</c>`;
}

export function sheetXml(
  rows: Array<{ r: number; cells: XlsxCell[] }>,
): string {
  const body = rows
    .map((row) => `<row r="${row.r}">${row.cells.map(cellXml).join('')}</row>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

export interface WorkbookOptions {
  /** Worksheets in workbook order; the first visible one is what is read. */
  sheets: Array<{ name: string; xml: string; state?: 'hidden' | 'veryHidden' }>;
  /** Shared string table; plain strings or raw `<si>` inner XML. */
  sharedStrings?: string[];
  /** Custom number formats by id. */
  numberFormats?: Record<number, string>;
  /** numFmtId per style index (`s` attribute). */
  cellFormats?: number[];
  /** Parts written as given, replacing a generated part with the same path. */
  parts?: Record<string, string | Buffer>;
  /** Uncompressed sizes to declare instead of the true ones, by part path. */
  declaredSizes?: Record<string, number>;
}

/**
 * A workbook whose first sheet in the workbook is `sheets[0]`, stored as the
 * last worksheet part, so a reader that guesses `sheet1.xml` reads the
 * wrong sheet.
 */
export function buildXlsx(options: WorkbookOptions): Buffer {
  const parts = options.sheets.map((sheet, index) => ({
    ...sheet,
    id: `rId${index + 1}`,
    path: `worksheets/sheet${options.sheets.length - index}.xml`,
  }));
  const relationships = parts
    .map(
      (part) =>
        `<Relationship Id="${part.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${part.path}"/>`,
    )
    .join('');

  const files: Record<string, string | Buffer> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      parts
        .map(
          (part, index) =>
            `<sheet name="${escapeXml(part.name)}" sheetId="${index + 1}"${part.state ? ` state="${part.state}"` : ''} r:id="${part.id}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relationships +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'xl/sharedStrings.xml':
      '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (options.sharedStrings ?? [])
        .map((value) =>
          value.startsWith('<')
            ? `<si>${value}</si>`
            : `<si><t>${escapeXml(value)}</t></si>`,
        )
        .join('') +
      '</sst>',
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts>' +
      Object.entries(options.numberFormats ?? {})
        .map(
          ([id, code]) =>
            `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`,
        )
        .join('') +
      '</numFmts><cellXfs>' +
      (options.cellFormats ?? [0])
        .map(
          (id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0"/>`,
        )
        .join('') +
      '</cellXfs></styleSheet>',
  };
  for (const part of parts) files[`xl/${part.path}`] = part.xml;
  Object.assign(files, options.parts);
  return buildZip(files, { declaredSizes: options.declaredSizes });
}

/** Bytes of `text` in Windows-1252, for the characters Swedish files use. */
export function windows1252(text: string): Buffer {
  const special: Record<string, number> = {
    å: 0xe5,
    ä: 0xe4,
    ö: 0xf6,
    Å: 0xc5,
    Ä: 0xc4,
    Ö: 0xd6,
    é: 0xe9,
  };
  return Buffer.from(
    [...text].map((char) => special[char] ?? char.charCodeAt(0)),
  );
}

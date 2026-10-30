import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  normalizeOrderHeading,
  parseOrderFile,
  parseOrderQuantity,
} from '../../../../server/utils/cart-import/parse';
import {
  XLSX_MAX_INFLATED_BYTES,
  XLSX_MAX_STRUCTURE_PART_BYTES,
} from '../../../../server/utils/cart-import/xlsx';
import {
  listZipEntries,
  readZipEntry,
  ZipReadError,
} from '../../../../server/utils/cart-import/zip';
import {
  CART_IMPORT_MAX_FILE_BYTES,
  CART_IMPORT_MAX_ROWS,
} from '../../../../shared/constants/cart-import';
import {
  buildXlsx,
  buildZip,
  sheetXml,
  windows1252,
  type XlsxCell,
} from '../../../fixtures/order-files';

const NBSP = String.fromCharCode(0xa0);
const ZERO_WIDTH = String.fromCharCode(0x200b);

function text(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function read(content: Buffer, fileName = 'order.csv') {
  const result = parseOrderFile(content, fileName);
  if (!result.ok) throw new Error(`file refused: ${result.error}`);
  return result;
}

function refusal(content: Buffer, fileName = 'order.csv') {
  const result = parseOrderFile(content, fileName);
  return result.ok ? null : result.error;
}

/** A one-sheet workbook from rows of cells. */
function workbook(
  rows: XlsxCell[][],
  extra: Omit<Parameters<typeof buildXlsx>[0], 'sheets'> = {},
): Buffer {
  return buildXlsx({
    ...extra,
    sheets: [
      {
        name: 'Order',
        xml: sheetXml(rows.map((cells, index) => ({ r: index + 1, cells }))),
      },
    ],
  });
}

const header: XlsxCell[] = [
  { ref: 'A1', type: 'inlineStr', text: 'Artikelnummer' },
  { ref: 'B1', type: 'inlineStr', text: 'Antal' },
];

/** A heading and one order line in rows 1 and 2. */
function orderRows(article: string, quantity: string): XlsxCell[][] {
  return [
    header,
    [
      { ref: 'A2', type: 'inlineStr', text: article },
      { ref: 'B2', raw: quantity },
    ],
  ];
}

function orderSheet(article: string, quantity: string): string {
  return sheetXml(
    orderRows(article, quantity).map((cells, index) => ({
      r: index + 1,
      cells,
    })),
  );
}

/** Where `buildXlsx` puts the parts of a one-sheet workbook. */
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';

describe('parseOrderFile — CSV delimiters', () => {
  it('reads a semicolon file with a recognised heading', () => {
    const result = read(text('Artikelnummer;Antal\r\nA-100;2\r\nB-200;5\r\n'));
    expect(result.columns).toEqual({
      article: 0,
      quantity: 1,
      headerRow: 1,
      headerRecognized: true,
    });
    expect(result.entries).toEqual([
      { articleNumber: 'A-100', quantity: 2, rows: [2] },
      { articleNumber: 'B-200', quantity: 5, rows: [3] },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('reads a comma file', () => {
    const result = read(text('Article number,Qty\nA-100,2\n'));
    expect(result.entries).toEqual([
      { articleNumber: 'A-100', quantity: 2, rows: [2] },
    ]);
  });

  it('reads a tab file', () => {
    const result = read(text('SKU\tQuantity\nA-100\t3\n'));
    expect(result.entries[0]).toMatchObject({
      articleNumber: 'A-100',
      quantity: 3,
    });
  });

  it("follows Excel's sep= hint and does not count it as a row", () => {
    const result = read(text('sep=,\nArtikelnummer,Antal\nA-1,1\n'));
    expect(result.columns.headerRow).toBe(1);
    expect(result.entries).toEqual([
      { articleNumber: 'A-1', quantity: 1, rows: [2] },
    ]);
  });

  it('keeps delimiters, doubled quotes and line breaks inside quoted fields', () => {
    const result = read(
      text('Artikelnummer;Benämning;Antal\n"A;1";"Skruv ""M6""\nlång";4\n'),
    );
    expect(result.columns.quantity).toBe(2);
    expect(result.entries).toEqual([
      { articleNumber: 'A;1', quantity: 4, rows: [2] },
    ]);
  });

  it('is not misled by commas in an order line above a semicolon table', () => {
    const result = read(
      text('Kund: Exempel AB, Göteborg\nArtikelnummer;Antal\nA-1;2\nB-2;3\n'),
    );
    expect(result.columns.headerRow).toBe(2);
    expect(result.entries.map((entry) => entry.articleNumber)).toEqual([
      'A-1',
      'B-2',
    ]);
  });

  it('does not split a decimal comma in a semicolon file', () => {
    const result = read(text('Artikelnummer;Antal\nA-1;1,5\n'));
    expect(result.problems).toEqual([
      {
        reason: 'invalid_quantity',
        rows: [2],
        articleNumber: 'A-1',
        quantity: '1,5',
      },
    ]);
  });
});

describe('parseOrderFile — encodings', () => {
  it('strips a UTF-8 byte-order mark before reading the heading', () => {
    const content = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      text('Artikelnummer;Antal\nÅÄÖ-1;2\n'),
    ]);
    const result = read(content);
    expect(result.columns.headerRecognized).toBe(true);
    expect(result.entries[0]?.articleNumber).toBe('ÅÄÖ-1');
  });

  it('reads UTF-8 without a byte-order mark', () => {
    const result = read(text('Art.nr;Antal\nSKRUV-Ö;1\n'));
    expect(result.entries[0]?.articleNumber).toBe('SKRUV-Ö');
  });

  it('reads Windows-1252, as Swedish Excel writes CSV, keeping å ä ö', () => {
    const result = read(
      windows1252('Benämning;Artikelnummer;Antal\r\nBåt;BÅT-ÄÖ;3\r\n'),
    );
    expect(result.columns.article).toBe(1);
    expect(result.entries).toEqual([
      { articleNumber: 'BÅT-ÄÖ', quantity: 3, rows: [2] },
    ]);
  });

  it('reads UTF-16 little-endian with a byte-order mark', () => {
    const content = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Artikelnummer\tAntal\r\nÖ-1\t2\r\n', 'utf16le'),
    ]);
    expect(read(content).entries).toEqual([
      { articleNumber: 'Ö-1', quantity: 2, rows: [2] },
    ]);
  });
});

describe('parseOrderFile — XLSX', () => {
  it('reads the first sheet in workbook order, not the first part on disk', () => {
    const order = sheetXml([
      { r: 1, cells: header },
      {
        r: 2,
        cells: [
          { ref: 'A2', type: 'inlineStr', text: 'FIRST-1' },
          { ref: 'B2', raw: '2' },
        ],
      },
    ]);
    const other = sheetXml([
      {
        r: 1,
        cells: [
          { ref: 'A1', type: 'inlineStr', text: 'OTHER-1' },
          { ref: 'B1', raw: '9' },
        ],
      },
    ]);
    const content = buildXlsx({
      sheets: [
        { name: 'Order', xml: order },
        { name: 'Notes', xml: other },
      ],
    });
    const result = read(content, 'order.xlsx');
    expect(result.format).toBe('xlsx');
    expect(result.entries).toEqual([
      { articleNumber: 'FIRST-1', quantity: 2, rows: [2] },
    ]);
  });

  it.each(['hidden', 'veryHidden'] as const)(
    'reads the first visible sheet, not a %s one before it',
    (state) => {
      const content = buildXlsx({
        sheets: [
          { name: 'Lookup', xml: orderSheet('HIDDEN-1', '1'), state },
          { name: 'Order', xml: orderSheet('VISIBLE-1', '2') },
        ],
      });
      expect(read(content, 'order.xlsx').entries).toEqual([
        { articleNumber: 'VISIBLE-1', quantity: 2, rows: [2] },
      ]);
    },
  );

  it('reads the first sheet when every sheet is hidden', () => {
    const content = buildXlsx({
      sheets: [
        { name: 'A', xml: orderSheet('FIRST-1', '1'), state: 'hidden' },
        { name: 'B', xml: orderSheet('SECOND-1', '2'), state: 'veryHidden' },
      ],
    });
    expect(read(content, 'order.xlsx').entries).toEqual([
      { articleNumber: 'FIRST-1', quantity: 1, rows: [2] },
    ]);
  });

  it('reads a shared-string cell with no value as empty, not as the first string', () => {
    const content = workbook(
      [
        [
          { ref: 'A1', type: 's', raw: '0' },
          { ref: 'B1', type: 's', raw: '1' },
        ],
        [
          { ref: 'A2', type: 's' },
          { ref: 'B2', raw: '2' },
        ],
      ],
      { sharedStrings: ['Artikelnummer', 'Antal'] },
    );
    const result = read(content, 'order.xlsx');
    expect(result.entries).toEqual([]);
    expect(result.problems).toEqual([
      {
        reason: 'missing_article_number',
        rows: [2],
        articleNumber: '',
        quantity: '2',
      },
    ]);
  });

  it('takes a text cell such as 12E5 as written', () => {
    const content = workbook(orderRows('12E5', '1'));
    const result = read(content, 'order.xlsx');
    expect(result.entries).toEqual([
      { articleNumber: '12E5', quantity: 1, rows: [2] },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('reads shared strings, rich text and inline strings, skipping phonetic runs', () => {
    const content = workbook(
      [
        [
          { ref: 'A1', type: 's', raw: '0' },
          { ref: 'B1', type: 's', raw: '1' },
        ],
        [
          { ref: 'A2', type: 's', raw: '2' },
          { ref: 'B2', raw: '3' },
        ],
        [
          { ref: 'A3', type: 'inlineStr', text: 'INLINE-1' },
          { ref: 'B3', raw: '1' },
        ],
      ],
      {
        sharedStrings: [
          'Artikelnummer',
          'Antal',
          '<r><t>AB</t></r><r><t xml:space="preserve">-12</t></r><rPh sb="0" eb="1"><t>X</t></rPh>',
        ],
      },
    );
    expect(read(content, 'order.xlsx').entries).toEqual([
      { articleNumber: 'AB-12', quantity: 3, rows: [2] },
      { articleNumber: 'INLINE-1', quantity: 1, rows: [3] },
    ]);
  });

  it('gives a numeric article number back as its exact digits, never in scientific notation', () => {
    const content = workbook([
      header,
      [
        { ref: 'A2', raw: '1234567890123' },
        { ref: 'B2', raw: '1' },
      ],
      [
        { ref: 'A3', raw: '1.2345678901234E+13' },
        { ref: 'B3', raw: '2' },
      ],
    ]);
    expect(
      read(content, 'order.xlsx').entries.map((entry) => entry.articleNumber),
    ).toEqual(['1234567890123', '12345678901234']);
  });

  it('flags an integer longer than Excel can hold as altered', () => {
    const content = workbook([
      header,
      [
        { ref: 'A2', raw: '12345678901234567' },
        { ref: 'B2', raw: '1' },
      ],
    ]);
    const result = read(content, 'order.xlsx');
    expect(result.entries).toEqual([]);
    expect(result.problems).toEqual([
      {
        reason: 'article_number_altered',
        rows: [2],
        articleNumber: '12345678901234567',
      },
    ]);
  });

  it('restores leading zeros shown by a zero-padding number format', () => {
    const content = workbook(
      [
        header,
        [
          { ref: 'A2', raw: '1234', style: 1 },
          { ref: 'B2', raw: '1' },
        ],
      ],
      { numberFormats: { 164: '000000' }, cellFormats: [0, 164] },
    );
    expect(read(content, 'order.xlsx').entries[0]?.articleNumber).toBe(
      '001234',
    );
  });

  it('keeps a text cell with leading zeros as written', () => {
    const content = workbook(
      [
        header,
        [
          { ref: 'A2', type: 's', raw: '0' },
          { ref: 'B2', raw: '1' },
        ],
      ],
      { sharedStrings: ['00123'] },
    );
    // Shared string 0 is the article here; the heading is inline.
    expect(read(content, 'order.xlsx').entries[0]?.articleNumber).toBe('00123');
  });

  it('flags an article number Excel turned into a date', () => {
    const content = workbook(
      [
        header,
        [
          { ref: 'A2', raw: '45728', style: 1 },
          { ref: 'B2', raw: '1' },
        ],
      ],
      { cellFormats: [0, 14] },
    );
    expect(read(content, 'order.xlsx').problems[0]?.reason).toBe(
      'article_number_altered',
    );
  });

  it('reads cached formula values and never evaluates a formula', () => {
    const content = workbook([
      header,
      [
        { ref: 'A2', type: 'str', formula: 'CONCAT("A","-1")', raw: 'A-1' },
        { ref: 'B2', formula: 'C2*2', raw: '4' },
      ],
      [
        { ref: 'A3', type: 'inlineStr', text: 'B-2' },
        { ref: 'B3', formula: 'C3*2' },
      ],
    ]);
    const result = read(content, 'order.xlsx');
    expect(result.entries).toEqual([
      { articleNumber: 'A-1', quantity: 4, rows: [2] },
    ]);
    expect(result.problems).toEqual([
      {
        reason: 'invalid_quantity',
        rows: [3],
        articleNumber: 'B-2',
        quantity: '',
      },
    ]);
  });

  it('treats an error cell as empty', () => {
    const content = workbook([
      header,
      [
        { ref: 'A2', type: 'inlineStr', text: 'A-1' },
        { ref: 'B2', type: 'e', raw: '#N/A' },
      ],
    ]);
    expect(read(content, 'order.xlsx').problems[0]?.reason).toBe(
      'invalid_quantity',
    );
  });

  it('reads namespace-prefixed elements and cells without references', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
      '<x:row><x:c t="inlineStr"><x:is><x:t>SKU</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>Qty</x:t></x:is></x:c></x:row>' +
      '<x:row><x:c t="inlineStr"><x:is><x:t>P-1</x:t></x:is></x:c><x:c><x:v>7</x:v></x:c></x:row>' +
      '</x:sheetData></x:worksheet>';
    const content = buildXlsx({ sheets: [{ name: 'Order', xml }] });
    expect(read(content, 'order.xlsx').entries).toEqual([
      { articleNumber: 'P-1', quantity: 7, rows: [2] },
    ]);
  });

  it('reads a workbook whose parts are stored uncompressed', () => {
    const content = buildZip(
      {
        'xl/workbook.xml':
          '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': sheetXml([
          { r: 1, cells: header },
          {
            r: 2,
            cells: [
              { ref: 'A2', type: 'inlineStr', text: 'S-1' },
              { ref: 'B2', raw: '1' },
            ],
          },
        ]),
      },
      { store: true },
    );
    expect(read(content, 'order.xlsx').entries[0]?.articleNumber).toBe('S-1');
  });

  it('refuses a legacy .xls workbook with its own reason', () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512),
    ]);
    expect(refusal(ole, 'order.xls')).toBe('legacy_excel');
  });

  it('reads an .xls that is really a text export', () => {
    expect(
      read(text('Artikelnummer\tAntal\nA-1\t2\n'), 'export.xls').entries,
    ).toHaveLength(1);
  });

  it('refuses an .xlsx that is not a workbook, or a damaged one', () => {
    expect(refusal(text('Artikelnummer;Antal\nA-1;1'), 'order.xlsx')).toBe(
      'unreadable',
    );
    const damaged = workbook([header]).subarray(0, 200);
    expect(refusal(damaged, 'order.xlsx')).toBe('unreadable');
  });
});

describe('ZIP reading', () => {
  it('stops inflating at the ceiling whatever the archive claims', () => {
    const archive = buildZip(
      { 'big.xml': Buffer.alloc(200_000, 0x20) },
      { declaredSizes: { 'big.xml': 1_000 } },
    );
    const entry = listZipEntries(archive).get('big.xml');
    expect(entry).toBeDefined();
    expect(() => readZipEntry(archive, entry!, 10_000)).toThrow(ZipReadError);
    expect(readZipEntry(archive, entry!, 200_000)).toHaveLength(200_000);
  });

  it('refuses an entry whose header declares more than the ceiling before inflating it', () => {
    const archive = buildZip(
      { 'small.xml': 'x' },
      { declaredSizes: { 'small.xml': 200_000 } },
    );
    const entry = listZipEntries(archive).get('small.xml')!;
    expect(() => readZipEntry(archive, entry, 10_000)).toThrow(ZipReadError);
    expect(readZipEntry(archive, entry, 200_000).toString()).toBe('x');
  });

  it('refuses an encrypted entry', () => {
    const archive = buildZip({ 'a.xml': 'x' }, { store: true });
    const entry = listZipEntries(archive).get('a.xml')!;
    expect(() => readZipEntry(archive, { ...entry, flags: 1 }, 100)).toThrow(
      ZipReadError,
    );
  });
});

describe('parseOrderFile — columns', () => {
  it.each([
    ['Artikelnummer', 'Antal'],
    ['Art.nr', 'Antal'],
    ['ARTNR', 'QTY'],
    ['SKU', 'Quantity'],
    ['Article Number', 'Qty'],
    ['Item number', 'Kvantitet'],
    ['Produktnummer', 'antal'],
    ['Tuotenumero', 'Määrä'],
  ])('recognises the heading %s / %s', (article, quantity) => {
    const result = read(text(`${article};${quantity}\nA-1;2\n`));
    expect(result.columns.headerRecognized).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it('normalises case, accents and punctuation in headings', () => {
    expect(normalizeOrderHeading('Art.nr')).toBe('artnr');
    expect(normalizeOrderHeading(' Määrä ')).toBe('maara');
    expect(normalizeOrderHeading('Article Number')).toBe('articlenumber');
  });

  it('finds the heading row below order details', () => {
    const result = read(
      text(
        'Beställning 1234;\nDatum;2026-10-01\n\nArtnr;Benämning;Antal\nA-1;Skruv;2\n',
      ),
    );
    expect(result.columns).toMatchObject({
      article: 0,
      quantity: 2,
      headerRow: 4,
    });
    expect(result.entries).toEqual([
      { articleNumber: 'A-1', quantity: 2, rows: [5] },
    ]);
  });

  it('reads the columns wherever the heading puts them', () => {
    const result = read(text('Antal;Benämning;Artikelnummer\n3;Skruv;A-1\n'));
    expect(result.columns).toMatchObject({ article: 2, quantity: 0 });
    expect(result.entries[0]).toMatchObject({
      articleNumber: 'A-1',
      quantity: 3,
    });
  });

  it('reads column A and B when there is no heading', () => {
    const result = read(text('A-1;2\nB-2;3\n'));
    expect(result.columns).toEqual({
      article: 0,
      quantity: 1,
      headerRow: null,
      headerRecognized: false,
    });
    expect(result.entries).toHaveLength(2);
  });

  it('skips a first row in words it does not recognise as a heading', () => {
    const result = read(text('Item;Count\nA-1;2\n'));
    expect(result.columns).toMatchObject({
      headerRow: 1,
      headerRecognized: false,
    });
    expect(result.entries).toEqual([
      { articleNumber: 'A-1', quantity: 2, rows: [2] },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('refuses a heading with no quantity column', () => {
    expect(refusal(text('Artikelnummer;Benämning\nA-1;Skruv\n'))).toBe(
      'missing_quantity_column',
    );
  });

  it('refuses a heading with no article number column', () => {
    expect(refusal(text('Benämning;Antal\nSkruv;2\n'))).toBe(
      'missing_article_column',
    );
  });
});

describe('parseOrderFile — cleaning and quantities', () => {
  it('trims spaces, non-breaking spaces and zero-width characters', () => {
    const result = read(
      text(`Artikelnummer;Antal\n ${NBSP}A-1${ZERO_WIDTH} ;${NBSP}2 \n`),
    );
    expect(result.entries).toEqual([
      { articleNumber: 'A-1', quantity: 2, rows: [2] },
    ]);
  });

  it('skips empty rows without renumbering the rest', () => {
    const result = read(text('Artikelnummer;Antal\n\nA-1;2\n;\nB-2;1\n'));
    expect(result.entries.map((entry) => entry.rows)).toEqual([[3], [5]]);
  });

  it('sums duplicate article numbers, whatever their case, and keeps every row', () => {
    const result = read(text('Artikelnummer;Antal\nA-1;2\nB-1;1\na-1;3\n'));
    expect(result.entries).toEqual([
      { articleNumber: 'A-1', quantity: 5, rows: [2, 4] },
      { articleNumber: 'B-1', quantity: 1, rows: [3] },
    ]);
  });

  it.each([['0'], ['-1'], ['1.5'], ['2,0'], ['abc'], ['']])(
    'refuses the quantity "%s" with its row number',
    (quantity) => {
      const result = read(
        text(`Artikelnummer;Antal\nA-1;${quantity}\nB-1;1\n`),
      );
      expect(result.problems).toEqual([
        {
          reason: 'invalid_quantity',
          rows: [2],
          articleNumber: 'A-1',
          quantity,
        },
      ]);
      expect(result.entries).toEqual([
        { articleNumber: 'B-1', quantity: 1, rows: [3] },
      ]);
    },
  );

  it('accepts whole numbers grouped by spaces and nothing that needs a guess', () => {
    expect(parseOrderQuantity('12')).toBe(12);
    expect(parseOrderQuantity('007')).toBe(7);
    expect(parseOrderQuantity(`1${NBSP}000`)).toBe(1000);
    expect(parseOrderQuantity('1 000')).toBe(1000);
    expect(parseOrderQuantity('1,000')).toBeNull();
    expect(parseOrderQuantity('1.000')).toBeNull();
    expect(parseOrderQuantity('1 2')).toBeNull();
    expect(parseOrderQuantity('0')).toBeNull();
  });

  it('reports a row with a quantity but no article number', () => {
    const result = read(text('Artikelnummer;Antal\n;4\n'));
    expect(result.problems).toEqual([
      {
        reason: 'missing_article_number',
        rows: [2],
        articleNumber: '',
        quantity: '4',
      },
    ]);
  });

  it('flags an article number Excel wrote in scientific notation', () => {
    const result = read(text('Artikelnummer;Antal\n1,23457E+13;1\n'));
    expect(result.problems[0]).toMatchObject({
      reason: 'article_number_altered',
      rows: [2],
    });
  });

  it.each(['1.23457E+13', '1E+15', '-1,5E-05'])(
    'flags %s, another shape Excel writes a shortened number in',
    (article) => {
      const result = read(text(`Artikelnummer;Antal\n${article};1\n`));
      expect(result.problems[0]).toMatchObject({
        reason: 'article_number_altered',
        rows: [2],
      });
    },
  );

  it('takes an article number such as 12E5 as written, since Excel never writes one so', () => {
    const result = read(text('Artikelnummer;Antal\n12E5;1\n3e10;2\n'));
    expect(result.entries).toEqual([
      { articleNumber: '12E5', quantity: 1, rows: [2] },
      { articleNumber: '3e10', quantity: 2, rows: [3] },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('refuses a quantity above the cart line limit, also when duplicates add up to it', () => {
    const result = read(
      text('Artikelnummer;Antal\nA-1;1000\nB-1;600\nB-1;400\n'),
    );
    expect(result.entries).toEqual([]);
    expect(result.problems).toEqual([
      {
        reason: 'quantity_too_large',
        rows: [2],
        articleNumber: 'A-1',
        quantity: '1000',
      },
      {
        reason: 'quantity_too_large',
        rows: [3, 4],
        articleNumber: 'B-1',
        quantity: '1000',
      },
    ]);
  });
});

describe('parseOrderFile — limits', () => {
  function rows(count: number): Buffer {
    const lines = Array.from({ length: count }, (_, index) => `ART-${index};1`);
    return text(`Artikelnummer;Antal\n${lines.join('\n')}\n`);
  }

  it(`accepts ${CART_IMPORT_MAX_ROWS} rows`, () => {
    expect(read(rows(CART_IMPORT_MAX_ROWS)).entries).toHaveLength(
      CART_IMPORT_MAX_ROWS,
    );
  });

  it(`refuses ${CART_IMPORT_MAX_ROWS + 1} rows`, () => {
    expect(refusal(rows(CART_IMPORT_MAX_ROWS + 1))).toBe('too_many_rows');
  });

  it('refuses a workbook over the row limit', () => {
    const many = Array.from(
      { length: CART_IMPORT_MAX_ROWS + 1 },
      (_, index) => [
        {
          ref: `A${index + 2}`,
          type: 'inlineStr' as const,
          text: `ART-${index}`,
        },
        { ref: `B${index + 2}`, raw: '1' },
      ],
    );
    expect(refusal(workbook([header, ...many]), 'order.xlsx')).toBe(
      'too_many_rows',
    );
  });

  it('refuses a file over 1 MB', () => {
    expect(refusal(Buffer.alloc(CART_IMPORT_MAX_FILE_BYTES + 1, 0x41))).toBe(
      'file_too_large',
    );
  });

  it('refuses an empty file and a file with no order rows', () => {
    expect(refusal(Buffer.alloc(0))).toBe('empty_file');
    expect(refusal(text('Artikelnummer;Antal\n\n'))).toBe('no_rows');
  });

  it('refuses other file types and binary content', () => {
    expect(refusal(text('Artikelnummer;Antal\nA-1;1'), 'order.pdf')).toBe(
      'unsupported_format',
    );
    expect(
      refusal(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), 'order.csv'),
    ).toBe('unsupported_format');
  });
});

describe('parseOrderFile — XLSX inflate budget', () => {
  /** `xml` with trailing spaces up to `bytes`. */
  function padded(xml: string, bytes: number): string {
    return xml + ' '.repeat(bytes - Buffer.byteLength(xml));
  }

  /** More than half the budget, so two such parts cannot both fit. */
  const half = XLSX_MAX_INFLATED_BYTES / 2 + 1024;

  it('reads a workbook that inflates to nearly the whole budget', () => {
    const content = workbook(orderRows('A-1', '1'), {
      parts: {
        [SHEET_PART]: padded(
          orderSheet('A-1', '1'),
          XLSX_MAX_INFLATED_BYTES - 64 * 1024,
        ),
      },
    });
    expect(read(content, 'order.xlsx').entries).toHaveLength(1);
  });

  it('refuses a part whose header declares more than the budget', () => {
    const content = workbook(orderRows('A-1', '1'), {
      declaredSizes: { [SHEET_PART]: XLSX_MAX_INFLATED_BYTES + 1 },
    });
    expect(refusal(content, 'order.xlsx')).toBe('unreadable');
  });

  it.each([
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    STYLES_PART,
  ])('refuses %s when it declares more than its own ceiling', (part) => {
    const content = workbook(orderRows('A-1', '1'), {
      declaredSizes: { [part]: XLSX_MAX_STRUCTURE_PART_BYTES + 1 },
    });
    expect(refusal(content, 'order.xlsx')).toBe('unreadable');
  });

  it('refuses parts that together declare more than the budget', () => {
    const content = workbook(orderRows('A-1', '1'), {
      parts: {
        [SHEET_PART]: padded(orderSheet('A-1', '1'), half),
        [SHARED_STRINGS_PART]: padded('<sst></sst>', half),
      },
    });
    expect(refusal(content, 'order.xlsx')).toBe('unreadable');
  });

  it('refuses parts that together inflate past the budget, whatever their headers declare', () => {
    const content = workbook(orderRows('A-1', '1'), {
      parts: {
        [SHEET_PART]: padded(orderSheet('A-1', '1'), half),
        [SHARED_STRINGS_PART]: padded('<sst></sst>', half),
      },
      declaredSizes: { [SHEET_PART]: 1024, [SHARED_STRINGS_PART]: 1024 },
    });
    expect(refusal(content, 'order.xlsx')).toBe('unreadable');
  });
});

describe('parseOrderFile — hostile input in linear time', () => {
  /**
   * Each input below took seconds while a reader searched the rest of the
   * file again for every tag or quote; read in one forward pass it takes
   * milliseconds. The limit sits far from both.
   */
  const TIME_LIMIT_MS = 500;
  const TAGS = 64 * 1024;

  function timed<T>(run: () => T): { result: T; ms: number } {
    const started = performance.now();
    const result = run();
    return { result, ms: performance.now() - started };
  }

  function worksheet(body: string): string {
    return `<worksheet><sheetData>${body}</sheetData></worksheet>`;
  }

  it.each<[string, Record<string, string>]>([
    ['<row>', { [SHEET_PART]: worksheet('<row>'.repeat(TAGS)) }],
    [
      '<c>',
      { [SHEET_PART]: worksheet(`<row r="1">${'<c>'.repeat(TAGS)}</row>`) },
    ],
    [
      '<v>',
      {
        [SHEET_PART]: worksheet(
          `<row r="1"><c r="A1">${'<v>'.repeat(TAGS)}</c></row>`,
        ),
      },
    ],
    [
      '<is>',
      {
        [SHEET_PART]: worksheet(
          `<row r="1"><c r="A1" t="inlineStr">${'<is>'.repeat(TAGS)}</c></row>`,
        ),
      },
    ],
    ['<si>', { [SHARED_STRINGS_PART]: `<sst>${'<si>'.repeat(TAGS)}</sst>` }],
    [
      '<t>',
      { [SHARED_STRINGS_PART]: `<sst><si>${'<t>'.repeat(TAGS)}</si></sst>` },
    ],
    [
      '<rPh>',
      { [SHARED_STRINGS_PART]: `<sst><si>${'<rPh>'.repeat(TAGS)}</si></sst>` },
    ],
    [
      '<cellXfs>',
      { [STYLES_PART]: `<styleSheet>${'<cellXfs>'.repeat(TAGS)}</styleSheet>` },
    ],
  ])('refuses a workbook of %s elements never closed', (_tag, parts) => {
    const content = workbook(orderRows('A-1', '1'), { parts });
    const { result, ms } = timed(() => refusal(content, 'order.xlsx'));
    expect(result).toBe('unreadable');
    expect(ms).toBeLessThan(TIME_LIMIT_MS);
  });

  it('reads past start tags that never end', () => {
    const content = workbook(orderRows('A-1', '1'), {
      parts: {
        'xl/_rels/workbook.xml.rels': `<Relationships>${'<Relationship'.repeat(TAGS / 2)}`,
      },
    });
    const { result, ms } = timed(() => read(content, 'order.xlsx'));
    expect(result.entries).toHaveLength(1);
    expect(ms).toBeLessThan(TIME_LIMIT_MS);
  });

  it('reads a number format of unclosed brackets', () => {
    const content = workbook(
      [
        header,
        [
          { ref: 'A2', raw: '1234', style: 1 },
          { ref: 'B2', raw: '1' },
        ],
      ],
      {
        numberFormats: { 164: '['.repeat(TAGS / 2) },
        cellFormats: [0, 164],
      },
    );
    const { result, ms } = timed(() => read(content, 'order.xlsx'));
    expect(result.entries[0]?.articleNumber).toBe('1234');
    expect(ms).toBeLessThan(TIME_LIMIT_MS);
  });

  it.each([
    ['a value and then quotes', `a${'"'.repeat(200_000)}`],
    [
      'spaces, a value and then quotes',
      `${' '.repeat(60_000)}a${'"'.repeat(60_000)}`,
    ],
  ])('reads a CSV field of %s', (_shape, field) => {
    const content = text(`Artikelnummer;Antal\n${field};1\n`);
    const { result, ms } = timed(() => read(content));
    expect(result.entries).toHaveLength(1);
    expect(ms).toBeLessThan(TIME_LIMIT_MS);
  });
});

describe('download template', () => {
  const localesDir = resolve(__dirname, '../../../../app/locales');
  const locales = readdirSync(localesDir).filter((file) =>
    file.endsWith('.json'),
  );

  it.each(locales)(
    'the %s template heading is one the import recognises',
    (file) => {
      const messages = JSON.parse(
        readFileSync(join(localesDir, file), 'utf-8'),
      ) as {
        cart: { file_import: Record<string, string> };
      };
      const {
        template_article_header: article,
        template_quantity_header: quantity,
      } = messages.cart.file_import;
      const result = read(text(`${article};${quantity}\r\nA-1;2\r\n`));
      expect(result.columns.headerRecognized).toBe(true);
    },
  );

  it('is exactly Artikelnummer;Antal in Swedish', () => {
    const messages = JSON.parse(
      readFileSync(join(localesDir, 'sv.json'), 'utf-8'),
    ) as {
      cart: { file_import: Record<string, string> };
    };
    const {
      template_article_header: article,
      template_quantity_header: quantity,
    } = messages.cart.file_import;
    expect(`${article};${quantity}`).toBe('Artikelnummer;Antal');
  });
});

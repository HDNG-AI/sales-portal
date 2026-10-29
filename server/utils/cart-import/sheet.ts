/**
 * The common shape both readers (CSV and XLSX) hand to the order-file parser:
 * rows of cell text, each with the row number the buyer sees in Excel.
 */

export interface SheetCell {
  text: string;
  /**
   * True when Excel stored the value in a way that can no longer give back
   * what was typed: an integer of more than 15 digits, or a date.
   */
  altered?: boolean;
}

export interface SheetRow {
  rowNumber: number;
  cells: SheetCell[];
}

export interface SheetReadResult {
  rows: SheetRow[];
  /** True when the reader stopped at its row limit with rows left over. */
  truncated: boolean;
}

/** Columns past this are ignored; an order file never needs them. */
export const SHEET_MAX_COLUMNS = 256;

export function isBlankSheetRow(cells: SheetCell[]): boolean {
  return cells.every((cell) => !cell.text.trim());
}

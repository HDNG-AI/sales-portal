import type { CartType, StockStatus } from './commerce';

/** Why a whole file was refused before any row was read. */
export type CartImportFileError =
  | 'empty_file'
  | 'file_too_large'
  | 'too_many_rows'
  | 'unsupported_format'
  | 'legacy_excel'
  | 'unreadable'
  | 'missing_article_column'
  | 'missing_quantity_column'
  | 'no_rows';

/** Why a row cannot go into the cart. */
export type CartImportProblemReason =
  | 'missing_article_number'
  | 'invalid_quantity'
  | 'quantity_too_large'
  | 'article_number_altered'
  | 'not_found'
  | 'variant_required'
  | 'out_of_stock'
  | 'insufficient_stock';

/** Where the article number and quantity were read from (0-based columns). */
export interface CartImportColumns {
  article: number;
  quantity: number;
  /** Row number of the heading row, or null when the file has none. */
  headerRow: number | null;
  /** False when the heading row did not name the columns we use. */
  headerRecognized: boolean;
}

/** One article that resolved to a purchasable SKU. */
export interface CartImportLine {
  /** The article number as written in the file (first occurrence). */
  articleNumber: string;
  skuId: number;
  name: string;
  /** Summed over every row naming this article. */
  quantity: number;
  /** Spreadsheet row numbers the quantity came from. */
  rows: number[];
  /** How many of this SKU the cart already holds. */
  inCartQuantity: number;
  /** Present only when the buyer may see stock. */
  stockStatus?: StockStatus;
  /** Removed at the API boundary when the buyer may not see prices. */
  unitPrice?: {
    sellingPriceIncVatFormatted?: string | null;
    sellingPriceExVatFormatted?: string | null;
  } | null;
}

/** One article or row that will not be added, with the rows it came from. */
export interface CartImportProblem {
  reason: CartImportProblemReason;
  rows: number[];
  articleNumber: string;
  /** The quantity cell as written, for quantity problems. */
  quantity?: string;
  /** Product name, when the article was found but cannot be bought. */
  name?: string;
}

export type CartImportPreview =
  | { status: 'invalid'; error: CartImportFileError }
  | {
      status: 'ok';
      columns: CartImportColumns;
      lines: CartImportLine[];
      problems: CartImportProblem[];
      /**
       * The cart in the request could not be shown to be this buyer's, so
       * nothing was read from it and the lines go into a new cart.
       */
      newCart?: true;
    };

/** What the client sends to add the previewed lines. */
export interface CartImportAddItem {
  skuId: number;
  quantity: number;
  articleNumber: string;
  /**
   * What the previewed cart held of the SKU. The add brings the cart to this
   * plus `quantity`, so sending the same lines twice adds them once.
   */
  inCartQuantity: number;
}

export type CartImportAddFailure = 'rejected' | 'quantity_limit' | 'timed_out';

export interface CartImportAddResult {
  cart: CartType;
  added: CartImportAddItem[];
  failed: Array<CartImportAddItem & { reason: CartImportAddFailure }>;
}

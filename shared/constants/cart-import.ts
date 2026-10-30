/**
 * Limits for importing an order file into the cart. The server enforces every
 * one of them; the client checks the file size and extension first so a buyer
 * hears about a wrong file before it is uploaded.
 */

/** Largest file accepted, in bytes. */
export const CART_IMPORT_MAX_FILE_BYTES = 1024 * 1024;

/** Most data rows read from one file, header excluded. */
export const CART_IMPORT_MAX_ROWS = 500;

/**
 * Largest quantity one cart line may reach. Matches the ceiling the cart's own
 * add and update routes validate against (`CartAddItemSchema`).
 */
export const CART_IMPORT_MAX_QUANTITY = 999;

/** Extensions the file picker offers. Anything else is refused. */
export const CART_IMPORT_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

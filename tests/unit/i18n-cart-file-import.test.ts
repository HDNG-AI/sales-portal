/**
 * The cart file import builds message keys from codes the server sends
 * (`cart.file_import.errors.${code}` and the like). Each record below must
 * name every member of its union, so a new code fails `pnpm typecheck` here
 * until it is listed, and then this test until every locale translates it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  CartImportAddFailure,
  CartImportFileError,
  CartImportProblemReason,
} from '../../shared/types/cart-import';

const FILE_ERRORS: Record<CartImportFileError, true> = {
  empty_file: true,
  file_too_large: true,
  too_many_rows: true,
  unsupported_format: true,
  legacy_excel: true,
  unreadable: true,
  missing_article_column: true,
  missing_quantity_column: true,
  no_rows: true,
};
const REASONS: Record<CartImportProblemReason, true> = {
  missing_article_number: true,
  invalid_quantity: true,
  quantity_too_large: true,
  article_number_altered: true,
  not_found: true,
  variant_required: true,
  out_of_stock: true,
  insufficient_stock: true,
};
const ADD_FAILURES: Record<CartImportAddFailure, true> = {
  rejected: true,
  quantity_limit: true,
  timed_out: true,
};

const LOCALES_DIR = resolve(__dirname, '../../app/locales');

describe('cart file import messages', () => {
  const files = readdirSync(LOCALES_DIR).filter((file) =>
    file.endsWith('.json'),
  );

  it.each(files)('%s translates every code the import can send', (file) => {
    const messages = JSON.parse(
      readFileSync(join(LOCALES_DIR, file), 'utf-8'),
    ) as {
      cart?: {
        file_import?: {
          new_cart?: string;
          errors?: Record<string, string>;
          reasons?: Record<string, string>;
          add_failures?: Record<string, string>;
        };
      };
    };
    const section = messages.cart?.file_import;
    const missing = [
      ...(section?.new_cart ? [] : ['new_cart']),
      ...Object.keys(FILE_ERRORS).filter((code) => !section?.errors?.[code]),
      ...Object.keys(REASONS).filter((code) => !section?.reasons?.[code]),
      ...Object.keys(ADD_FAILURES).filter(
        (code) => !section?.add_failures?.[code],
      ),
    ];
    expect(missing).toEqual([]);
  });
});

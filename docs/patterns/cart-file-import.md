# Cart file import

A signed-in buyer uploads an Excel or CSV file of article numbers and
quantities from the cart page, checks what it resolves to, and adds it to the
cart. Off unless the tenant sets the `cartFileImport` feature.

## Turning it on

Set the feature in the tenant's Geins storefront settings:

```json
{
  "features": {
    "cartFileImport": { "enabled": true, "access": "authenticated" }
  }
}
```

The key has no seeded default in `storefront-settings-defaults.ts`, so an
absent key is off. Whatever `access` says, both routes and the button also
require a signed-in buyer and `orderPlacement`, and refuse in catalogue mode.

## Flow

```
CartPage ── "Upload file" ──▶ CartFileImportDialog
  file (≤ 1 MB, base64 in JSON) ──▶ POST /api/cart/import/preview
      parseOrderFile → resolveOrderEntries → protectProductPrices
  ◀── lines + problems (with row numbers)
  buyer removes lines, presses "Add N items"
  cartStore.importItems ──▶ POST /api/cart/import/add
      addImportedItems → cart service (addItem / updateItem) → getCart
  ◀── cart as Geins now holds it + added / failed per line
```

Nothing touches the cart before the buyer presses add, and only matched lines
are sent. The file is read in memory for the one request: it is not stored,
and the routes log counts only. `sentry.server.config.ts` drops request bodies
for these routes, since Sentry would otherwise attach up to 10 kB of them.

## Reading the file

`server/utils/cart-import/` reads the file without a spreadsheet library:

- **XLSX**: a small ZIP reader (`zip.ts`) over `node:zlib`, with a ceiling on
  every inflated part, and a SpreadsheetML reader (`xlsx.ts`) for the first
  sheet in workbook order. Only cached values are read; formulas are never
  evaluated. Numbers come back as their stored digits rather than Excel's
  display text, and a zero-padding format such as `000000` is applied, so
  leading zeros survive. An integer of more than 15 digits, or a date, cannot
  give back what was typed and is reported as `article_number_altered`.
- **Legacy .xls** (BIFF) is refused with its own message asking for .xlsx or
  CSV. An `.xls` that is really a text export is read as CSV.
- **CSV** (`csv.ts`): a byte-order mark decides the encoding (UTF-8,
  UTF-16); otherwise UTF-8 if it decodes, else Windows-1252. The delimiter is
  `;`, tab or `,`, whichever splits most sample lines into the same number of
  fields; Excel's `sep=` first line wins. Text in scientific notation is
  reported as altered.

`parse.ts` then finds the heading row among the first 20 rows by alias
(case, accents and punctuation ignored); without one, column A is the
article number and B the quantity. Quantities are whole numbers above zero,
digits only (`1 000` is accepted, `1,000` is not guessed at). Duplicate
article numbers, compared case-insensitively, are summed. Limits: 1 MB, 500
data rows, 999 per cart line, which is the cart routes' own ceiling.

## Matching article numbers

One `products(filter: { articleNumbers, includeCollapsed: true })` query per
300 articles, each sent as written and upper-cased (Geins caps the filter at
600 values), with the buyer's token, market and language. A product the buyer
may not see does not come back and reads as not found.

A SKU's own `articleNumber` wins. A product's `articleNumber` names a SKU only
when the product has exactly one; with several it is `variant_required`
rather than a guess. Stock follows the product page: `out-of-stock` on the
total basis is refused, and so is more than `purchasableQuantity` allows after
what the cart already holds. The label the buyer sees uses the tenant's
`layout.stockLevelBasis`, and is left out when `stockStatus` hides stock.
Prices are Geins' own for this buyer, passed through `protectProductPrices`.

## Adding

`addImportedItems` raises an existing line with `updateItem` and adds new
SKUs with `addItem`, four at a time. The outcome is then read from the cart
itself, not from the calls: a call can fail after Geins applied it, or race
another. A SKU still short gets one sequential top-up. What is reported added
is in the cart, and nothing else is.

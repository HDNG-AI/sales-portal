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

The deployment also needs `NUXT_CART_OWNER_SECRET` (see "Whose cart" below).
Without it both routes answer 503.

## Who may call

`guardCartImport` runs before the body is read:

- a request without `Content-Length` is refused (411), and one declaring more
  than the file limit allows is refused (413);
- the session must be one Geins confirms (`verifiedBuyerId`, the same check
  that decides private prices). A preview or login-as session has no refresh
  token and is refused (401);
- requests are limited per address and then per buyer, so a new
  `X-Forwarded-For` does not lift the limit.

## Whose cart

A Geins cart belongs to no one, and its id sits in a cookie the client can
read, so knowing an id must not be enough to read or fill the cart.
`server/utils/cart-ownership.ts` keeps an httpOnly `cart_owner` cookie with
an HMAC over the tenant, the cart id and the owner:

- `POST /api/cart` gives the browser that created a cart a proof with no
  buyer in it;
- the first import by a signed-in buyer binds it to that buyer, so another
  buyer who signs in on the same browser cannot use the cart;
- a cart the import creates is bound to its buyer from the start.

The preview reads a named cart only with a matching proof. Without one it
counts from an empty cart and answers `newCart: true`; the dialog says the
lines go into a new cart and adds without the old id. The add route refuses a
named cart without proof (403). Carts created before the key was set, and
every cart after the key changes, have no valid proof: the buyer keeps the
cart, but their next import goes into a new one. Only the import checks the
proof; the other cart routes still take any id.

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

- **XLSX**: a small ZIP reader (`zip.ts`) over `node:zlib` and a
  SpreadsheetML reader (`xlsx.ts`) for the first visible sheet in workbook
  order. All parts together may inflate to 8 MiB, and the relationships,
  workbook and styles parts to 1 MiB each; an entry declared larger than
  what is left is refused before it is inflated, and the inflate itself is
  capped too, since a declared size can lie. The XML is scanned forward
  only: an element whose end tag is missing makes the file unreadable
  rather than being searched for again, so a crafted file cannot cost
  quadratic time. Only cached values are read; formulas are never
  evaluated. Numbers come back as their stored digits rather than Excel's
  display text, and a zero-padding format such as `000000` is applied, so
  leading zeros survive. An integer of more than 15 digits, or a date, cannot
  give back what was typed and is reported as `article_number_altered`.
- **Legacy .xls** (BIFF) is refused with its own message asking for .xlsx or
  CSV. An `.xls` that is really a text export is read as CSV.
- **CSV** (`csv.ts`): a byte-order mark decides the encoding (UTF-8,
  UTF-16); otherwise UTF-8 if it decodes, else Windows-1252. The delimiter is
  `;`, tab or `,`, whichever splits most sample lines into the same number of
  fields; Excel's `sep=` first line wins. A value in the shape Excel gives a
  long number (`1,23457E+13`: one digit, a fraction, a signed exponent of two
  digits or more) is reported as altered; an article number such as `12E5`
  is not.

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

Each line carries the `inCartQuantity` the preview showed, and the add brings
the SKU to that plus the file's quantity. Pressing add again after a failure
therefore adds nothing twice. When the named cart is gone or checked out, a
new cart is made and its targets count from zero; any other failure to read
the cart fails the request rather than swap the cart. The cart limit counts
every line of the SKU, as the preview does.

`addImportedItems` raises an existing line with `updateItem` and adds new
SKUs with `addItem`, four at a time. No call starts after 20 s, so the answer
beats a gateway timeout; lines not reached are reported as `timed_out`, and
the buyer can send them again. The outcome is then read from the cart itself,
not from the calls: a call can fail after Geins applied it, or race another.
A SKU still short gets one sequential top-up. What is reported added is in
the cart, and nothing else is.

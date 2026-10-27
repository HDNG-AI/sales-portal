# Variant selection on the PDP

The PDP variant selector handles two distinct shapes Geins returns,
and the difference matters because the same UI must drive both.

## Two shapes

### Internal multi-SKU products

One product, several SKUs. The variant axis lives entirely within the
current product:

- `product.skus.length > 1`
- `product.variantDimensions` carries the product's own row, on the
  internal `DefaultProduct` dimension when it has no siblings
- `product.variantGroup` carries this product's node, its SKUs below it
  as `DefaultSku` leaves

The SKUs are offered as their own group (`skuOptions` / `skuId`), apart
from the dimension selection. Picking one stays on the page, and add to
cart asks for a pick before it adds anything.

### Sibling-variant products

Each variant value is a separate Geins product with its own alias and
URL. The current product has a single SKU; the other variants live in
the `variantGroup`:

- `product.skus.length === 1`
- `product.variantDimensions` carries only this product's own row
  (one entry)
- `product.variantGroup.variants.length > 1` carries all sibling
  products with their `alias`, `dimension`, `label`, `value`

Selecting a variant value navigates to the sibling product's alias.

### Both at once

A product sold in several SKUs can also have siblings. The selector then
shows the sibling dimension and the SKU group together. They never
combine: a dimension pick either keeps this product (its own value) or
leaves for the sibling's page, and the SKU pick always belongs to the
product on screen. Add to cart is disabled while a sibling switch loads,
the sibling's product clears the SKU pick, and a failed switch puts the
selection back on this product.

## Where the data merges

`VariantSelector.vue` builds `groupedDimensions` by merging values
from both sources:

1. `props.variantDimensions` — values for internal SKU axes
2. `props.variants` (mapped from `product.variantGroup.variants`) —
   values from sibling products in the same group

This merge is required because for sibling-variant products the
current product's `variantDimensions` only contains one row, so the
sheet would otherwise show a single option.

## Where the gate sits

`ProductDetails.vue` renders the selector only when at least one
dimension exists AND more than one variant is reachable from either
shape:

```ts
const showVariantSelector = computed(() => {
  if (skuOptions.value.length) return true;
  const dims = product.value?.variantDimensions ?? [];
  if (!dims.length) return false;
  const skuCount = product.value?.skus?.length ?? 0;
  const siblingCount = product.value?.variantGroup?.variants?.length ?? 0;
  return skuCount > 1 || siblingCount > 1;
});
```

A product with one SKU and no sibling group has nothing to switch
between, so the selector is hidden.

## UI

The trigger renders as a labeled select-style button. Clicking it
opens a full-height right-slide `Sheet` (see SAL-100) with one row
per variant value, each row showing thumbnail, article number, stock
and price. Tablet and mobile use the same sheet.

## Related

- `app/components/product/VariantSelector.vue` — sheet + value merge
- `app/components/pages/ProductDetails.vue` — `showVariantSelector`
- `shared/types/commerce.ts` — `VariantDimensionType`, `VariantType`

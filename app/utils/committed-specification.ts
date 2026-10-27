import type { ConfigurationVariable } from '#shared/types/configurator';
import type { LineConfigurationGroup, LineConfigurationSection, LineConfigurationSummary, PriceType } from '#shared/types/commerce';
import { exVatAmount, incVatAmount, sideAmount, vatAmount } from '#shared/utils/configurator-price';
function byIndex<T>(items: T[], index: (item: T) => number | null): T[] {
  return [...items].sort((a, b) => (index(a) ?? Number.POSITIVE_INFINITY) - (index(b) ?? Number.POSITIVE_INFINITY));
}

export interface CommittedSpecificationValue {
  text?: string;
  number?: number;
  decimals?: number;
  boolValue?: boolean;
  none?: boolean;
  unit?: string;
  quantity?: number;
  price?: PriceType;
}
export interface CommittedSpecificationRow {
  id: string;
  group: string;
  label: string;
  values: CommittedSpecificationValue[];
}
function variableValue(variable: Pick<ConfigurationVariable, 'value' | 'unit' | 'decimals'>): CommittedSpecificationValue | undefined {
  const { value } = variable;
  const unit = variable.unit ? { unit: variable.unit } : {};
  if (typeof value === 'boolean') return value ? { boolValue: true } : undefined;
  if (typeof value === 'number') return value === 0 ? undefined : { number: value, decimals: variable.decimals, ...unit };
  if (typeof value === 'string' && value !== '') return { text: value, ...unit };
  return undefined;
}

function committedGroupRows(
  group: LineConfigurationGroup,
  section: string,
): CommittedSpecificationRow[] {
  const rows: CommittedSpecificationRow[] = group.options.length
    ? [
        {
          id: `group:${group.id}`,
          group: section,
          label: group.name,
          values: group.options.map((option) => ({
            text: option.name,
            ...(option.quantity === undefined
              ? {}
              : { quantity: option.quantity }),
            ...(option.unitPrice ? { price: option.unitPrice } : {}),
          })),
        },
      ]
    : [];
  for (const nested of byIndex(group.optionGroups, (g) => g.sortIndex)) {
    rows.push(...committedGroupRows(nested, section));
  }
  return rows;
}

/**
 * A committed line's choices as rows, grouped by section the way the
 * specification of a live configuration is.
 *
 * The structure holds only what was chosen, so there is nothing to filter but
 * a variable that holds nothing; a group without options cannot say "nothing
 * chosen", because it carries no rule that offers it. Siblings are ordered by
 * `sortIndex`, null last, a section's groups and variables merged as on the
 * page.
 */
export function committedSpecificationRows(
  sections: LineConfigurationSection[],
): CommittedSpecificationRow[] {
  const rows: CommittedSpecificationRow[] = [];

  for (const section of byIndex(sections, (s) => s.sortIndex)) {
    const members = byIndex(
      [
        ...section.optionGroups.map((group) => ({
          sortIndex: group.sortIndex,
          rows: () => committedGroupRows(group, section.name),
        })),
        ...section.variables.map((variable) => ({
          sortIndex: variable.sortIndex,
          rows: (): CommittedSpecificationRow[] => {
            const value = variableValue(variable);
            return value
              ? [
                  {
                    id: `variable:${variable.id}`,
                    group: section.name,
                    label: variable.name,
                    values: [value],
                  },
                ]
              : [];
          },
        })),
      ],
      (member) => member.sortIndex,
    );
    for (const member of members) rows.push(...member.rows());
    rows.push(...committedSpecificationRows(section.sections));
  }

  return rows;
}

/** In cents, as a price is shown. */
function cents(amount: number): number {
  return Math.round(amount * 100);
}

function valueCents(value: CommittedSpecificationValue, inc: boolean): number {
  return Math.round(
    cents(sideAmount(value.price, inc)) * (value.quantity ?? 1),
  );
}

/**
 * What a row's value costs for one configured unit, on the side of the
 * buyer's VAT choice: the option's price as shown, times how many of it,
 * rounded to the cent. A quantity can be a fraction of a part.
 */
export function valueAmount(value: CommittedSpecificationValue, inc: boolean): number {
  return valueCents(value, inc) / 100;
}

/** One unit less the rows, each as it is shown, in cents. */
function remainderCents(
  unitPrice: PriceType,
  rows: CommittedSpecificationRow[],
  inc: boolean,
): number {
  const shown = rows
    .flatMap((row) => row.values)
    .reduce((sum, value) => sum + valueCents(value, inc), 0);
  return cents(sideAmount(unitPrice, inc)) - shown;
}

/**
 * What one unit costs beyond the options the rows show, zero included, on
 * the side the rows are shown on. The provider sends no base price, only the
 * options and the total, so this remainder is the only way the rows on screen
 * add up to it.
 *
 * Subtracts each row as it is shown, so a remainder made of rounding is zero.
 * Whether there is a row at all is decided before VAT on both sides: a
 * negative remainder there is a line that kept a stale price, not a base
 * price, and is `null`, as is a price that is not there. With VAT each option
 * is rounded on its own, so the rows can pass the unit by a few cents; the row
 * then reads zero.
 */
export function basePrice(
  unitPrice: PriceType | undefined,
  rows: CommittedSpecificationRow[],
  inc: boolean,
): number | null {
  if (!unitPrice) return null;
  const exVat = remainderCents(unitPrice, rows, false);
  if (exVat < 0) return null;
  if (!inc) return exVat / 100;
  return Math.max(0, remainderCents(unitPrice, rows, true)) / 100;
}

/**
 * A committed line's base price. Recorded sections with nothing in them still
 * get the row where nothing at all was chosen. Where the summary names choices
 * the sections do not hold, or a line was committed before its structure was
 * recorded, the remainder would include those choices, so there is none.
 */
export function lineBasePrice(
  configuration: LineConfigurationSummary,
  unitPrice: PriceType | undefined,
  inc: boolean,
): number | null {
  if (!configuration.sections) return null;
  const rows = committedSpecificationRows(configuration.sections);
  if (!rows.length && configuration.summary.length) return null;
  return basePrice(unitPrice, rows, inc);
}

/**
 * The price rows under a line's specification: the line's own total, as the
 * cart and the order show it.
 */
export function lineSpecificationTotals(
  totalPrice: PriceType | undefined,
): PriceTotals | null {
  if (!totalPrice) return null;
  return {
    net: exVatAmount(totalPrice),
    vat: vatAmount(totalPrice),
    incVat: incVatAmount(totalPrice),
  };
}

export interface PriceBlock {
  /** What the block leads with: net on the ex side, with VAT on the inc side. */
  price: number;
  vat: number;
  /** The amount with VAT under an ex-VAT price; `null` on the inc side. */
  totalIncVat: number | null;
}

/**
 * The price block on the side of the buyer's VAT choice, as the cart's
 * summary has it: the inc side's price already holds the VAT, so it needs no
 * third line.
 */
export function priceBlock(totals: PriceTotals, inc: boolean): PriceBlock {
  return inc
    ? { price: totals.incVat, vat: totals.vat, totalIncVat: null }
    : { price: totals.net, vat: totals.vat, totalIncVat: totals.incVat };
}


export interface PriceTotals { net: number; vat: number; incVat: number; }

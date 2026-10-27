<script setup lang="ts">
import type { FunctionalComponent } from 'vue';
import { Receipt } from 'lucide-vue-next';
import type { PaymentOptionType } from '#shared/types/commerce';
import { paymentTypeLabelKey } from '~/utils/payment-type';
import { formatPrice } from '#shared/types/commerce';

const { t } = useI18n();
const { showIncVat } = useVatDisplay();
const { formatLocale } = useFormatLocale();

const props = defineProps<{
  options: PaymentOptionType[];
  currencyCode?: string;
  modelValue: number | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

function selectOption(id: number) {
  emit('update:modelValue', id);
}

function fee(option: PaymentOptionType): number {
  const amount = showIncVat.value
    ? option.feeIncVat
    : option.feeExVat;

  return typeof amount === 'number' && Number.isFinite(amount)
    ? amount
    : 0;
}

function feeFormatted(option: PaymentOptionType): string {
  const amount = fee(option);

  if (amount <= 0) return '';

  return props.currencyCode
    ? formatPrice(amount, props.currencyCode, formatLocale.value)
    : '';
}

// Map the Geins paymentType enum to a localized fallback label. Used when
// the merchant has not configured a displayName or name on the option in
// Geins admin, which would otherwise leak the section title through the
// generic fallback. Anything not in the map (or missing entirely) defaults
// to "Invoice" / "Faktura" because invoice is the standard B2B option.


function paymentLabel(option: PaymentOptionType): string {
  if (option.displayName && option.displayName.trim())
    return option.displayName;
  if (option.name && option.name.trim()) return option.name;
  const key =
    paymentTypeLabelKey(option.paymentType);
  return t(key ?? 'checkout.payment_types.invoice');
}

// Icon shown next to each payment option label. Invoice/STANDARD gets a
// receipt icon, everything else a generic credit-card icon. Keeps the
// component dependency-free of the full lucide collection.
const PAYMENT_TYPE_ICONS: Record<string, FunctionalComponent> = {
  STANDARD: Receipt,
};

function paymentIcon(option: PaymentOptionType): FunctionalComponent {
  const key = option.paymentType as string | undefined;
  return (key && PAYMENT_TYPE_ICONS[key]) || Receipt;
}
</script>

<template>
  <fieldset data-testid="checkout-payment-options" :disabled="props.disabled">
    <legend class="sr-only">{{ t('checkout.payment_method') }}</legend>

    <p v-if="props.options.length === 0" class="text-muted-foreground text-sm">
      {{ t('checkout.no_payment_methods') }}
    </p>

    <div v-else class="space-y-3">
      <label
        v-for="option in props.options"
        :key="option.id"
        :data-testid="`payment-option-${option.id}`"
        class="border-border hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
        :class="{
          'border-primary bg-primary/5': props.modelValue === option.id,
        }"
      >
        <input
          type="radio"
          name="payment-method"
          :value="option.id"
          :checked="props.modelValue === option.id"
          :disabled="props.disabled"
          class="accent-primary focus-visible:ring-ring size-4 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          @change="selectOption(option.id)"
        />
        <div class="flex flex-1 items-center justify-between gap-3">
          <span class="flex items-center gap-2 text-sm font-medium">
            <component
              :is="paymentIcon(option)"
              class="text-muted-foreground size-4 shrink-0"
            />
            {{ paymentLabel(option) }}
          </span>
          <span
            v-if="fee(option) > 0 && props.currencyCode"
            class="text-muted-foreground text-xs"
          >
            +{{ feeFormatted(option) || "--" }}
          </span>
        </div>
      </label>
    </div>
  </fieldset>
</template>

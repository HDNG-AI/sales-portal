<script setup lang="ts">
import type { StockType, StockStatus } from '#shared/types/commerce';
import { getStockStatus } from '#shared/types/commerce';

const props = withDefaults(
  defineProps<{
    stock?: StockType;
    /** A status the server already derived on the tenant's basis. */
    status?: StockStatus;
    threshold?: number;
    size?: 'default' | 'sm';
  }>(),
  { threshold: 5, size: 'default' },
);

const { t } = useI18n();
const { showStock, stockLevelBasis } = useStockVisibility();

const status = computed<StockStatus | null>(() => {
  if (props.status) return props.status;
  if (!props.stock) return null;
  return getStockStatus(props.stock, props.threshold, stockLevelBasis.value);
});

const label = computed(() => {
  switch (status.value) {
    case 'in-stock':
      return t('product.in_stock');
    case 'low-stock':
      return t('product.low_stock');
    case 'out-of-stock':
      return t('product.out_of_stock');
    case 'on-demand':
      return t('product.on_demand');
    case 'backorder':
      return t('product.backorder');
    default:
      return '';
  }
});

const badgeClass = computed(() => {
  switch (status.value) {
    case 'in-stock':
      return 'border-success/30 bg-success/10 text-success';
    case 'low-stock':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'out-of-stock':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'on-demand':
      return 'border-border bg-muted text-foreground';
    case 'backorder':
      return 'border-info/30 bg-info/10 text-info';
    default:
      return '';
  }
});

const dotColor = computed(() => {
  switch (status.value) {
    case 'in-stock':
      return 'border-success';
    case 'low-stock':
      return 'border-warning';
    case 'out-of-stock':
      return 'border-destructive';
    case 'on-demand':
      return 'border-muted-foreground';
    case 'backorder':
      return 'border-info';
    default:
      return '';
  }
});

const labelClass = computed(() => {
  switch (status.value) {
    case 'in-stock':
      return 'text-success';
    case 'low-stock':
      return 'text-warning';
    case 'out-of-stock':
      return 'text-destructive';
    case 'on-demand':
      return 'text-foreground';
    case 'backorder':
      return 'text-info';
    default:
      return 'text-muted-foreground';
  }
});
</script>

<template>
  <!-- Compact inline: green dot + text -->
  <span
    v-if="showStock && status && size === 'sm'"
    class="inline-flex items-center gap-1 text-xs"
  >
    <span
      class="size-[9px] shrink-0 rounded-full border-2 bg-transparent"
      :class="dotColor"
    />
    <span :class="labelClass">{{ label }}</span>
  </span>

  <!-- Default: pill badge -->
  <Badge v-else-if="showStock && status" variant="outline" :class="badgeClass">
    {{ label }}
  </Badge>
</template>

<script setup lang="ts">
import type {
  LowestPriceInfo,
  PriceType,
  ProductDiscountType,
} from '#shared/types/commerce';

type PriceSlotMode = 'contract' | 'list' | 'hidden' | 'quote';

const props = withDefaults(
  defineProps<{
    mode: PriceSlotMode;
    price?: PriceType;
    showVat?: boolean;
    showDiscount?: boolean;
    fromPrice?: boolean;
    lowestPrice?: LowestPriceInfo;
    discountType?: ProductDiscountType;
    campaignNames?: string[];
    /** Where login should return. Defaults to the current route. */
    returnTo?: string;
  }>(),
  {
    showVat: undefined,
    showDiscount: true,
    fromPrice: false,
    returnTo: undefined,
  },
);

const emit = defineEmits<{
  'request-quote': [];
}>();

const route = useRoute();
const { localePath } = useLocaleMarket();

const returnTarget = computed(() => props.returnTo || route.fullPath);
const loginTarget = computed(() => ({
  path: localePath('/login'),
  query: { redirect: returnTarget.value },
}));
</script>

<template>
  <!--
    Fixed geometry is intentional. A price becoming visible after login must
    not resize every product card in the grid. All four states occupy this
    same slot; state changes replace content, not layout.
  -->
  <div
    class="flex h-16 items-center"
    :data-price-state="mode"
    data-testid="price-slot"
  >
    <PriceDisplay
      v-if="mode === 'contract' || mode === 'list'"
      :price="price"
      :show-vat="showVat"
      :show-discount="showDiscount"
      :from-price="fromPrice"
      :lowest-price="lowestPrice"
      :discount-type="discountType"
      :campaign-names="campaignNames"
    />

    <NuxtLink
      v-else-if="mode === 'hidden'"
      :to="loginTarget"
      class="text-primary inline-flex items-center font-semibold hover:underline"
      data-testid="price-login"
    >
      {{ $t('product.login_for_prices') }}
    </NuxtLink>

    <button
      v-else
      type="button"
      class="text-primary inline-flex items-center font-semibold hover:underline"
      data-testid="price-quote"
      @click="emit('request-quote')"
    >
      {{ $t('quote.request_quote') }}
    </button>
  </div>
</template>

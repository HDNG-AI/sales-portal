<script setup lang="ts">
import type { ProductListResponse } from '#shared/types/commerce';

/**
 * Rendered on the storefront landing page (`pages/index.vue`) when the
 * tenant has no FRONTPAGE_CONTENT CMS slot configured OR the configured
 * area returns no content.
 *
 * CMS remains authoritative. This fallback only exposes the tenant's live
 * catalogue so a valid storefront is still useful while CMS content is being
 * configured. No tenant-specific product data is embedded here.
 */
const { t } = useI18n();
const { tenant } = useTenant();
const { localeQuery, localePath } = useLocaleMarket();

const brandName = computed(() => tenant.value?.branding?.name?.trim() || null);
const productsHref = computed(() => localePath('/products'));

const { data: productsData, status: productsStatus } =
  useFetch<ProductListResponse>('/api/product-lists/products', {
    query: computed(() => ({
      skip: 0,
      take: 8,
      ...localeQuery.value,
    })),
    dedupe: 'defer',
  });

const products = computed(() => productsData.value?.products ?? []);
const productsLoading = computed(() => productsStatus.value === 'pending');
</script>

<template>
  <section
    data-testid="frontpage-fallback"
    class="bg-muted/30"
    aria-labelledby="frontpage-fallback-title"
  >
    <div class="mx-auto max-w-6xl px-4 py-12 text-center sm:py-16">
      <h1
        id="frontpage-fallback-title"
        class="text-3xl font-semibold sm:text-5xl"
      >
        <template v-if="brandName">
          {{ t('frontpage.fallback.welcome_named', { brand: brandName }) }}
        </template>
        <template v-else>
          {{ t('frontpage.fallback.welcome') }}
        </template>
      </h1>
      <p
        class="text-muted-foreground mx-auto mt-4 max-w-xl text-sm sm:text-base"
      >
        {{ t('frontpage.fallback.subtitle') }}
      </p>
      <NuxtLink
        :to="productsHref"
        class="bg-primary text-primary-foreground mt-6 inline-flex h-10 items-center justify-center rounded-md px-5 text-sm font-medium shadow-sm transition-opacity hover:opacity-90"
        data-testid="frontpage-products-cta"
      >
        {{ t('nav.products') }}
      </NuxtLink>
    </div>

    <div class="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
      <div v-if="productsLoading && products.length === 0" class="py-8">
        <div class="bg-muted mx-auto h-8 w-48 animate-pulse rounded" />
      </div>

      <div v-else-if="products.length" data-testid="frontpage-live-catalogue">
        <div class="mb-6 flex items-center justify-between gap-4">
          <h2 class="font-heading text-2xl font-bold sm:text-3xl">
            {{ t('nav.products') }}
          </h2>
          <NuxtLink
            :to="productsHref"
            class="text-sm font-medium underline-offset-4 hover:underline"
          >
            {{ t('nav.products') }}
          </NuxtLink>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NuxtLink
            v-for="product in products"
            :key="product.productId"
            :to="product.canonicalUrl || productsHref"
            class="bg-background hover:bg-muted/40 rounded-lg border p-5 transition-colors"
          >
            <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {{ product.primaryCategory?.name || product.brand?.name || '' }}
            </p>
            <h3 class="mt-2 text-base font-semibold leading-snug">
              {{ product.name }}
            </h3>
            <p v-if="product.articleNumber" class="text-muted-foreground mt-2 text-sm">
              {{ product.articleNumber }}
            </p>
          </NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>

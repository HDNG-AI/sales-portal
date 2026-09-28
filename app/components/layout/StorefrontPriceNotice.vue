<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { CMS_TAGS } from '#shared/constants/cms';

const authStore = useAuthStore();
const { canUnlockByAuth } = usePriceVisibility();
const { hasFeature } = useTenant();
const { to: applyTo, isResolved: applyResolved } = useCmsPageLink(
  CMS_TAGS.APPLY_PAGE,
);
</script>

<template>
  <aside
    v-if="canUnlockByAuth"
    class="bg-accent text-accent-foreground border-b"
    data-slot="price-notice"
  >
    <div
      class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm lg:px-6"
    >
      <button
        type="button"
        class="font-semibold underline-offset-4 hover:underline"
        @click="authStore.openSheet('login')"
      >
        {{ $t('product.login_for_prices') }}
      </button>
      <NuxtLink
        v-if="hasFeature('applyForAccount') && applyResolved"
        :to="applyTo"
        class="underline underline-offset-4"
      >
        {{ $t('layout.apply_for_account') }}
      </NuxtLink>
    </div>
  </aside>
</template>

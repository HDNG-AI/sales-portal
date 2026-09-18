<script setup lang="ts">
import { LogOut, Mail, User } from 'lucide-vue-next';
import { useAuthStore } from '~/stores/auth';
import { CMS_TAGS } from '#shared/constants/cms';

const authStore = useAuthStore();
const { localePath } = useLocaleMarket();
const { logout } = useLogout();
const { to: contactTo, isResolved: contactResolved } = useCmsPageLink(
  CMS_TAGS.CONTACT_PAGE,
);
</script>

<template>
  <div
    data-slot="topbar"
    class="bg-top-bar-background text-top-bar-text w-full text-sm"
  >
    <div class="flex h-12 items-center justify-between px-4 lg:px-6">
      <!-- Left: Contact + Locale -->
      <div class="flex items-center gap-4">
        <NuxtLink
          v-if="contactResolved"
          :to="contactTo"
          :aria-label="$t('layout.contact_us')"
          class="flex items-center gap-1.5 py-2 hover:underline"
        >
          <Mail class="size-4" />
          <span class="hidden sm:inline">{{ $t('layout.contact_us') }}</span>
        </NuxtLink>
        <LocaleSwitcher variant="text" />
        <MarketSwitcher variant="text" />
        <VatDisplaySwitcher variant="text" />
      </div>

      <!-- Center: Env badge (dev only). Hidden below sm — its ~79px pushed
           the right-hand links past the viewport edge, overflowing the page
           horizontally on non-production environments. -->
      <div
        v-if="
          $config?.public?.environment &&
          $config.public.environment !== 'production'
        "
        class="hidden font-mono text-xs uppercase opacity-75 sm:block"
      >
        {{ $config.public.environment }}
      </div>

      <!-- Right: authenticated account utilities only. Anonymous login and
           account application are promoted to the main header. -->
      <div v-if="authStore.isAuthenticated" class="flex items-center gap-4">
        <NuxtLink
          :to="localePath('/portal')"
          :aria-label="$t('layout.customer_portal')"
          class="flex items-center gap-1.5 py-2 hover:underline"
          data-testid="topbar-portal"
        >
          <User class="size-4" />
          <span class="hidden sm:inline">{{ $t('layout.customer_portal') }}</span>
        </NuxtLink>
        <button
          type="button"
          :aria-label="$t('auth.logout')"
          class="hidden items-center gap-1.5 py-2 hover:underline lg:flex"
          data-testid="topbar-logout"
          @click="logout"
        >
          <LogOut class="size-4" />
          <span class="hidden sm:inline">{{ $t('auth.logout') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Building2, LogOut, Mail, User } from 'lucide-vue-next';
import { useAuthStore } from '~/stores/auth';
import { CMS_TAGS } from '#shared/constants/cms';
import type { Company } from '#shared/types/company';

const authStore = useAuthStore();
const { tenant } = useTenant();
const { localePath } = useLocaleMarket();
const { logout } = useLogout();
const { to: contactTo, isResolved: contactResolved } = useCmsPageLink(
  CMS_TAGS.CONTACT_PAGE,
);

// Opt-in per tenant: the name only means something where a buyer orders on
// behalf of an organisation, and it is a request this bar would otherwise
// make on every page view for every tenant.
const wantsCompanyName = computed(
  () =>
    tenant.value?.layout?.showCompanyName === true && authStore.isAuthenticated,
);

// Deferred rather than fetched on setup: /api/portal/company requires auth, so
// asking before login is a guaranteed 401, and asking at all is wasted work
// for the tenants that leave this off. Same key and dedupe as the portal
// pages, so navigating there reuses this response instead of refetching.
const { data: companyData, execute: loadCompany } = useFetch<{
  company: Company;
}>('/api/portal/company', { dedupe: 'defer', immediate: false });

watch(
  wantsCompanyName,
  (wanted) => {
    if (wanted && !companyData.value) loadCompany();
  },
  { immediate: true },
);

// Null when the buyer has no company on file, which is a normal state for a
// private customer — the block hides rather than rendering an empty chip.
const companyName = computed(() => companyData.value?.company?.name ?? null);
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
        <span
          v-if="wantsCompanyName && companyName"
          class="hidden items-center gap-1.5 py-2 md:flex"
          data-testid="topbar-company-name"
        >
          <Building2 class="size-4 shrink-0" />
          <span class="max-w-[22ch] truncate">{{ companyName }}</span>
        </span>
        <NuxtLink
          :to="localePath('/portal')"
          :aria-label="$t('layout.customer_portal')"
          class="flex items-center gap-1.5 py-2 hover:underline"
          data-testid="topbar-portal"
        >
          <User class="size-4" />
          <span class="hidden sm:inline">{{
            $t('layout.customer_portal')
          }}</span>
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

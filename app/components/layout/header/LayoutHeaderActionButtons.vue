<script setup lang="ts">
import {
  ShoppingCart,
  Search,
  Menu,
  User,
  UserPlus,
} from 'lucide-vue-next';
import { Button } from '~/components/ui/button';
import { useAppStore } from '~/stores/app';
import { useCartStore } from '~/stores/cart';
import { useAuthStore } from '~/stores/auth';
import { CMS_TAGS } from '#shared/constants/cms';

const appStore = useAppStore();
const cartStore = useCartStore();
const authStore = useAuthStore();
const { isCatalogMode, hasFeature } = useTenant();
const { canAccess } = useFeatureAccess();
const { to: applyTo, isResolved: applyResolved } = useCmsPageLink(
  CMS_TAGS.APPLY_PAGE,
);

// Cart entry points (header icon, drawer, /cart, checkout) all gate on
// orderPlacement: when a tenant has order placement disabled, the entire
// purchase funnel is hidden. The standalone `cart` feature flag is no
// longer the authority because cart/checkout always default to enabled
// while orderPlacement carries the real merchant intent.
const showCart = computed(
  () => !isCatalogMode.value && canAccess('orderPlacement'),
);
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Search toggle (mobile only; desktop has the inline SearchBar). Opens
         the dropdown search overlay, and tapping it again closes it. -->
    <Button
      variant="ghost"
      size="icon"
      data-slot="search-button"
      data-testid="mobile-search-trigger"
      class="lg:hidden"
      :aria-label="$t('nav.search_products')"
      :aria-expanded="appStore.mobileSearchOpen"
      @click="appStore.toggleMobileSearch()"
    >
      <Search class="size-5" />
    </Button>

    <!-- Anonymous conversion actions live in the main header, not the utility
         topbar: account application and login are the two primary B2B paths. -->
    <Button
      v-if="
        !authStore.isAuthenticated &&
        hasFeature('applyForAccount') &&
        applyResolved
      "
      variant="outline"
      size="sm"
      as-child
      class="font-semibold"
    >
      <NuxtLink
        :to="applyTo"
        data-testid="header-apply"
        :aria-label="$t('layout.apply_for_account')"
      >
        <UserPlus class="size-4" />
        <span class="hidden sm:inline">{{ $t('layout.apply_for_account') }}</span>
      </NuxtLink>
    </Button>

    <Button
      v-if="!authStore.isAuthenticated"
      type="button"
      size="sm"
      class="font-semibold"
      data-testid="header-login"
      :aria-label="$t('auth.login')"
      @click="authStore.openSheet('login')"
    >
      <User class="size-4" />
      <span class="hidden sm:inline">{{ $t('auth.login') }}</span>
    </Button>

    <Button
      v-if="showCart"
      variant="ghost"
      data-slot="cart-button"
      class="gap-1.5"
      :aria-label="`${cartStore.itemCount} ${$t('cart.items_short')}`"
      @click="cartStore.isOpen = true"
    >
      <ShoppingCart class="size-5" />
      <span
        v-if="cartStore.itemCount > 0"
        class="text-foreground text-sm font-medium"
      >
        {{ cartStore.itemCount }}
      </span>
    </Button>

    <!-- Hamburger (mobile only) -->
    <Button
      variant="ghost"
      size="icon"
      data-slot="menu-toggle"
      data-testid="mobile-nav-trigger"
      class="lg:hidden"
      @click="appStore.toggleSidebar()"
    >
      <Menu class="size-5" />
    </Button>
  </div>
</template>

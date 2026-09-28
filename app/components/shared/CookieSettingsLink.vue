<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

/**
 * Reopens the consent banner after a choice has been stored.
 *
 * Withdrawal has to be as easy as consent (GDPR Art. 7(3)), and the banner
 * hides for good once answered — so without an entry point like this one,
 * `revoke()` is unreachable and the only way back is clearing localStorage.
 *
 * Rendered only where the banner itself would be: a tenant with analytics off
 * has nothing to withdraw, and a link that opens an empty prompt is worse than
 * no link.
 */
const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();

const { reopen } = useAnalyticsConsent();
const { analyticsConfigured } = useTenant();
</script>

<template>
  <button
    v-if="analyticsConfigured"
    type="button"
    data-slot="cookie-settings-link"
    data-testid="cookie-settings-link"
    :class="
      cn(
        'text-footer-text/70 hover:text-footer-text text-xs underline underline-offset-4',
        props.class,
      )
    "
    @click="reopen"
  >
    {{ $t('cookies.settings') }}
  </button>
</template>

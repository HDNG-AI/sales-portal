<script setup lang="ts">
import { Button } from '~/components/ui/button';
import { CMS_TAGS } from '#shared/constants/cms';

const { isPrompting, accept, revoke } = useAnalyticsConsent();
const { hasFeature } = useTenant();

// The prompt has to say what is collected and why, and two buttons do not.
// Resolved by tag rather than a hardcoded slug so each locale's own page wins
// — see docs/patterns/cms-page-link.md. A tenant that has not tagged one gets
// the banner without the link rather than a dead link.
const { to: privacyTo, isResolved: privacyResolved } = useCmsPageLink(
  CMS_TAGS.PRIVACY_PAGE,
);

const visible = computed(() => isPrompting.value && hasFeature('analytics'));
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        v-if="visible"
        role="dialog"
        aria-label="Cookie consent"
        class="bg-card text-card-foreground fixed inset-x-0 bottom-0 z-50 rounded-t shadow-lg"
      >
        <div
          class="mx-auto flex max-w-screen-lg flex-col items-center gap-4 px-6 py-4 sm:flex-row sm:justify-between"
        >
          <p class="text-sm">
            {{ $t('cookies.banner_text') }}
            <NuxtLink
              v-if="privacyResolved"
              :to="privacyTo"
              data-testid="cookie-privacy-link"
              class="underline underline-offset-4"
            >
              {{ $t('cookies.privacy_policy') }}
            </NuxtLink>
          </p>
          <div class="flex shrink-0 gap-2">
            <Button @click="accept">
              {{ $t('cookies.accept') }}
            </Button>
            <Button variant="secondary" @click="revoke">
              {{ $t('cookies.decline') }}
            </Button>
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

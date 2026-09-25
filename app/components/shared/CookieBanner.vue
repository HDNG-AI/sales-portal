<script setup lang="ts">
import { Button } from '~/components/ui/button';

const { isPrompting, accept, revoke } = useAnalyticsConsent();
const { analyticsConfigured } = useTenant();

// Gated on analyticsConfigured, not the feature flag alone: with the flag on
// and no provider id, tenant-analytics.ts returns early and sets nothing, so
// the flag alone asks the visitor to consent to cookies that never arrive.
const visible = computed(() => isPrompting.value && analyticsConfigured.value);
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
          <div class="flex flex-col gap-1">
            <p class="text-sm">
              {{ $t('cookies.banner_text') }}
              <CookieBannerPrivacyLink />
            </p>
            <!-- GDPR Art. 7(3): the right to withdraw has to be communicated
               BEFORE consent is given, not merely be available afterwards. It
               names the footer control so the sentence is actionable. -->
            <p
              class="text-muted-foreground text-xs"
              data-testid="cookie-withdraw-note"
            >
              {{ $t('cookies.withdraw_note') }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <!-- Same variant on purpose. A primary Accept beside a muted
                 Decline nudges toward one answer, which goes to whether
                 consent is freely given at all (GDPR Recital 43). -->
            <Button variant="outline" @click="accept">
              {{ $t('cookies.accept') }}
            </Button>
            <Button variant="outline" @click="revoke">
              {{ $t('cookies.decline') }}
            </Button>
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

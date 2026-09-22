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
          <div class="flex flex-col gap-1">
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

<script setup lang="ts">
import { CMS_TAGS } from '#shared/constants/cms';

const { to: privacyTo, isResolved: privacyResolved } = useCmsPageLink(
  CMS_TAGS.PRIVACY_PAGE,
);
</script>

<template>
  <NuxtLink
    v-if="privacyResolved"
    :to="privacyTo"
    data-testid="cookie-privacy-link"
    class="underline underline-offset-4"
  >
    {{ $t('cookies.privacy_policy') }}
  </NuxtLink>
</template>

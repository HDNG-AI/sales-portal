<script setup lang="ts">
const { showNewsletter } = useNewsletterVisibility();
const { tenant } = useTenant();
</script>

<template>
  <footer class="bg-footer-background text-footer-text border-t">
    <LayoutFooterTop v-if="showNewsletter" />
    <LayoutFooterMain
      :branded="tenant?.layout?.storefrontStyle === 'editorial'"
    />
    <LayoutFooterBottom />
  </footer>
</template>

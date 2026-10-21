<script setup lang="ts">
import { Play } from 'lucide-vue-next';
import { videoProviderOf } from '#shared/utils/video-embed';

/**
 * A third-party video player that loads only when the visitor asks for it.
 *
 * Until then the page makes no request to the provider at all: no player, no
 * thumbnail, no IP address handed to YouTube or Vimeo. That is the consent
 * step — the button names the provider, and pressing it is the choice. It also
 * keeps the player's weight off pages where nobody watches.
 *
 * `src` must come from shared/utils/video-embed.ts. Anything that is not an
 * allowlisted player URL renders nothing, so a caller cannot widen the set of
 * framed origins by passing a different string.
 */
const props = defineProps<{
  src: string;
  title: string;
}>();

const { t } = useI18n();

const provider = computed(() => videoProviderOf(props.src));
const providerName = computed(() =>
  provider.value === 'vimeo' ? 'Vimeo' : 'YouTube',
);

const loaded = ref(false);

/** Autoplay after the click, so one press starts the film. */
const playerSrc = computed(() => {
  const url = new URL(props.src);
  url.searchParams.set('autoplay', '1');
  return url.toString();
});
</script>

<template>
  <div
    v-if="provider"
    data-testid="video-embed"
    class="bg-muted relative aspect-video w-full max-w-full overflow-hidden"
  >
    <iframe
      v-if="loaded"
      :src="playerSrc"
      :title="title"
      class="absolute inset-0 h-full w-full border-0"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
    />
    <button
      v-else
      type="button"
      data-testid="video-embed-consent"
      class="text-foreground hover:bg-muted/80 focus-visible:ring-ring absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center focus-visible:ring-2 focus-visible:outline-none"
      :aria-label="t('video.play', { title })"
      @click="loaded = true"
    >
      <span
        class="bg-primary text-primary-foreground flex h-14 w-14 items-center justify-center rounded-full"
      >
        <Play class="h-6 w-6" aria-hidden="true" />
      </span>
      <span class="text-sm font-medium">{{ title }}</span>
      <span class="text-muted-foreground max-w-sm text-xs">
        {{ t('video.consent', { provider: providerName }) }}
      </span>
    </button>
  </div>
</template>

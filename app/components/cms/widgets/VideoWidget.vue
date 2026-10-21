<script setup lang="ts">
import type { VideoWidgetData, ContentConfigType } from '#shared/types/cms';
import { buildVideoEmbedUrl } from '#shared/utils/video-embed';

const props = defineProps<{
  data: VideoWidgetData;
  config: ContentConfigType;
  layout: string;
}>();

/**
 * Geins CMS videoProvider field: 0=youtube, 1=vimeo.
 * The id is validated before it becomes a src; an id that no provider could
 * have issued renders nothing rather than a broken or redirected frame.
 */
const embedUrl = computed(() =>
  props.data.videoId
    ? buildVideoEmbedUrl(
        props.data.videoProvider === 1 ? 'vimeo' : 'youtube',
        props.data.videoId,
      )
    : null,
);
</script>

<template>
  <div v-if="embedUrl" data-testid="cms-widget" class="w-full min-w-0">
    <VideoEmbed :src="embedUrl" :title="config.displayName || 'Video'" />
  </div>
</template>

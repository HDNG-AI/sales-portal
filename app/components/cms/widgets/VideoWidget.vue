<script setup lang="ts">
import type { VideoWidgetData, ContentConfigType } from '#shared/types/cms';
import { resolveVideoField } from '#shared/utils/video-embed';
import { logger } from '~/utils/logger';

const props = defineProps<{
  data: VideoWidgetData;
  config: ContentConfigType;
  layout: string;
}>();

/**
 * Geins CMS videoProvider field: 0=youtube, 1=vimeo.
 * The field may hold an id, an id with a share suffix or a whole URL; it is
 * reduced to a validated id before it becomes a src, and a value no provider
 * could have issued renders nothing rather than a broken or redirected frame.
 */
const embedUrl = computed(() =>
  props.data.videoId
    ? resolveVideoField(
        props.data.videoProvider === 1 ? 'vimeo' : 'youtube',
        props.data.videoId,
      )
    : null,
);

// A rejected value is otherwise invisible: the widget just isn't there. Name
// its shape (never the value) so the merchant or a test run can see why.
onMounted(() => {
  if (!props.data.videoId || embedUrl.value) return;
  const value = props.data.videoId.trim();
  logger.warn(
    `[cms] video widget "${props.config.name}" skipped: provider=${props.data.videoProvider ?? 'unset'} length=${value.length} url=${/^[a-z]+:/i.test(value)}`,
  );
});
</script>

<template>
  <div v-if="embedUrl" data-testid="cms-widget" class="w-full min-w-0">
    <VideoEmbed :src="embedUrl" :title="config.displayName || 'Video'" />
  </div>
</template>

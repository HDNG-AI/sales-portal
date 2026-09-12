<script setup lang="ts">
import type { DetailProduct, ListProduct } from '#shared/types/commerce';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { adminText } from '~/utils/product-texts';
import {
  ExternalLink,
  FileArchive,
  FileAudio,
  FileAxis3d,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Play,
} from 'lucide-vue-next';
import {
  classifyMediaParameter,
  type ProductMediaFileType,
  type ProductMediaParameter,
} from '#shared/constants/product-media';

/**
 * The icon set carries no brand marks, so `pdf` and `text` share one —
 * these are format families, not exact formats.
 */
const DOCUMENT_ICONS = {
  pdf: FileText,
  text: FileText,
  spreadsheet: FileSpreadsheet,
  archive: FileArchive,
  image: FileImage,
  video: FileVideoCamera,
  audio: FileAudio,
  cad: FileAxis3d,
  code: FileCode,
} as const;

/**
 * A null fileType means the URL has no file extension to go on, so it
 * opens a page rather than downloading something — worth showing
 * differently so a shopper knows what a click will do.
 */
function documentIcon(fileType: ProductMediaFileType | null) {
  return fileType ? DOCUMENT_ICONS[fileType] : ExternalLink;
}

const props = defineProps<{
  product: DetailProduct;
  related?: ListProduct[] | null;
}>();

// True when the HTML carries visible copy, not just empty editor markup
// (e.g. `<p><br></p>`), so a blank field never shows an empty block.
function hasRenderableHtml(html: string | undefined): html is string {
  return !!html && html.replace(/<[^>]*>/g, '').trim().length > 0;
}

// The details tab shows the merchant's admin "Text 2" copy first, then
// "Text 3", each capped at max-w-3xl. `adminText` maps the PIM box numbers
// onto the offset Merchant API fields (see ~/utils/product-texts).
const detailsText2 = computed(() => {
  const html = adminText(props.product.texts, 2);
  return hasRenderableHtml(html) ? html : undefined;
});
const detailsText3 = computed(() => {
  const html = adminText(props.product.texts, 3);
  return hasRenderableHtml(html) ? html : undefined;
});
const hasDescription = computed(
  () => !!(detailsText2.value || detailsText3.value),
);
// Parameters whose name/value match this tenant's media convention (see
// shared/constants/product-media.ts and tenant.productMediaParameters) are
// pulled out of the spec table and rendered as embeds/download links in the
// Documents tab instead — a raw URL in a text-value row isn't useful to a
// shopper.
/**
 * `show: false` is the merchant admin saying "don't display this on the
 * storefront" — it applies equally to a spec row and to a media parameter,
 * so it's checked once here before a parameter is classified at all.
 * Treated as visible when the flag is absent: an unknown value shouldn't
 * blank out a product's whole spec table.
 */
function isVisibleParameter(param: { show?: boolean }): boolean {
  return param.show !== false;
}

const { productMediaParameters } = useTenant();

// Groups the catalogue marks as internal. Applied before classification, not
// only before the spec table: media lives on parameters like any other value,
// so classifying the unfiltered list published a hidden group's documents in
// the public Documents tab while its spec rows stayed correctly hidden.
const HIDDEN_PARAMETER_GROUPS = /^monitor$/i;
const shownGroups = computed(() =>
  (props.product.parameterGroups ?? []).filter(
    (g) => !HIDDEN_PARAMETER_GROUPS.test(g.name ?? ''),
  ),
);

const classifiedParameters = computed(() => {
  const videos: ProductMediaParameter[] = [];
  const documents: ProductMediaParameter[] = [];
  const mediaKeys = new Set<string>();
  for (const group of shownGroups.value) {
    for (const param of group.parameters ?? []) {
      if (!isVisibleParameter(param)) continue;
      // One parameter can carry several files, so this is 0-n entries —
      // an empty result means the parameter isn't media and stays in the
      // spec table below.
      const media = classifyMediaParameter(param, productMediaParameters.value);
      if (media.length === 0) continue;
      mediaKeys.add(`${group.parameterGroupId}:${param.name}`);
      for (const entry of media) {
        (entry.kind === 'video' ? videos : documents).push(entry);
      }
    }
  }
  return { videos, documents, mediaKeys };
});
/**
 * Host shown as the text of an external video link, so a shopper can see
 * where the link goes before following it. Falls back to the raw URL for a
 * value too malformed to parse — it passed the `https://` prefix check but
 * that doesn't make it a complete URL.
 */
function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const videoItems = computed(() => classifiedParameters.value.videos);
const documentItems = computed(() => classifiedParameters.value.documents);
const hasDocumentsContent = computed(
  () => videoItems.value.length > 0 || documentItems.value.length > 0,
);

const visibleGroups = computed(() =>
  shownGroups.value
    .map((g) => ({
      ...g,
      parameters: (g.parameters ?? []).filter(
        (p) =>
          isVisibleParameter(p) &&
          (p.label || p.name) &&
          p.value != null &&
          !classifiedParameters.value.mediaKeys.has(
            `${g.parameterGroupId}:${p.name}`,
          ),
      ),
    }))
    .filter((g) => g.parameters.length > 0),
);
const hasSpecs = computed(() => visibleGroups.value.length > 0);
const hasRelated = computed(() => (props.related?.length ?? 0) > 0);

// Every trigger is conditional, so a product with nothing to show still
// rendered an empty TabsList — a bare underline rule across the page, with
// no tab above it. Gate the whole control, not each trigger.
const hasAnyTab = computed(
  () =>
    hasDescription.value ||
    hasSpecs.value ||
    hasDocumentsContent.value ||
    hasRelated.value,
);

const defaultTab = computed(() => {
  if (hasDescription.value) return 'description';
  if (hasSpecs.value) return 'specifications';
  if (hasRelated.value) return 'related';
  return 'documents';
});

// Print expansion: radix Tabs sets the `hidden` HTML attribute on
// inactive panels. The `[hidden]` reset lives in Tailwind's @layer base
// with !important, and unlayered overrides cannot beat that because
// CSS cascade-layers reverses layer order for !important. The simplest
// reliable answer is to drop the attribute on `beforeprint` for the
// panels we want printed, and put it back on `afterprint`.
onMounted(() => {
  if (typeof window === 'undefined') return;
  const PRINT_VISIBLE = ['description', 'specifications'];
  const restoredHidden: HTMLElement[] = [];
  const onBeforePrint = () => {
    document
      .querySelectorAll<HTMLElement>(
        '[data-testid="product-tabs"] [data-print]',
      )
      .forEach((el) => {
        const key = el.getAttribute('data-print');
        if (key && PRINT_VISIBLE.includes(key) && el.hasAttribute('hidden')) {
          el.removeAttribute('hidden');
          restoredHidden.push(el);
        }
      });
  };
  const onAfterPrint = () => {
    while (restoredHidden.length) {
      const el = restoredHidden.pop()!;
      el.setAttribute('hidden', '');
    }
  };
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
  onBeforeUnmount(() => {
    window.removeEventListener('beforeprint', onBeforePrint);
    window.removeEventListener('afterprint', onAfterPrint);
  });
});
</script>

<template>
  <div data-testid="product-tabs">
    <!-- Desktop: Tabs (hidden below md via CSS to avoid SSR/client flash) -->
    <Tabs v-if="hasAnyTab" class="hidden md:block" :default-value="defaultTab">
      <TabsList variant="underline">
        <TabsTrigger v-if="hasDescription" value="description">
          {{ $t('product.details') }}
        </TabsTrigger>
        <TabsTrigger v-if="hasSpecs" value="specifications">
          {{ $t('product.specifications') }}
        </TabsTrigger>
        <TabsTrigger value="documents">
          {{ $t('product.documents') }}
        </TabsTrigger>
        <TabsTrigger v-if="hasRelated" value="related">
          {{ $t('product.related') }}
        </TabsTrigger>
      </TabsList>

      <TabsContent
        v-if="hasDescription"
        value="description"
        data-print="description"
        force-mount
        class="bg-card mt-6 rounded-lg border p-6 data-[state=inactive]:hidden"
      >
        <h3 class="font-heading mb-4 text-2xl font-bold">
          {{ $t('product.details') }}
        </h3>
        <!-- eslint-disable vue/no-v-html -->
        <div class="max-w-3xl space-y-6">
          <div
            v-if="detailsText2"
            class="prose max-w-none"
            v-html="detailsText2"
          />
          <div
            v-if="detailsText3"
            class="prose max-w-none"
            v-html="detailsText3"
          />
        </div>
        <!-- eslint-enable vue/no-v-html -->
      </TabsContent>

      <TabsContent
        v-if="hasSpecs"
        value="specifications"
        data-print="specifications"
        force-mount
        class="bg-card mt-6 rounded-lg border p-6 data-[state=inactive]:hidden"
      >
        <h3 class="font-heading mb-6 text-2xl font-bold">
          {{ $t('product.specifications') }}
        </h3>
        <div class="grid gap-8 md:grid-cols-2">
          <div
            v-for="group in visibleGroups"
            :key="group.name ?? group.parameterGroupId"
            class="flex flex-col gap-3"
          >
            <h4
              data-testid="spec-group-title"
              class="font-heading text-xl font-semibold"
            >
              {{ group.name }}
            </h4>
            <table class="w-full text-sm" data-testid="spec-table">
              <tbody>
                <tr
                  v-for="(param, idx) in group.parameters"
                  :key="param.identifier ?? param.name ?? idx"
                  class="border-border odd:bg-muted/40 border-b"
                >
                  <td class="text-muted-foreground px-3 py-3 pr-4">
                    {{ param.label || param.name || '' }}
                  </td>
                  <td class="px-3 py-3 text-right">{{ param.value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </TabsContent>

      <TabsContent
        value="documents"
        data-print="documents"
        class="bg-card mt-6 rounded-lg border p-6"
      >
        <h3 class="font-heading mb-4 text-2xl font-bold">
          {{ $t('product.documents') }}
        </h3>
        <div v-if="hasDocumentsContent" class="flex flex-col gap-8">
          <div
            v-if="videoItems.length"
            class="grid gap-6 sm:grid-cols-2"
            data-testid="product-videos"
          >
            <div
              v-for="(video, idx) in videoItems"
              :key="`${video.url}:${idx}`"
              class="flex flex-col gap-2"
            >
              <p class="text-sm font-medium">{{ video.label }}</p>
              <div
                class="border-border aspect-video w-full overflow-hidden rounded-lg border"
              >
                <!-- embedUrl is non-null exactly when display is 'embed';
                     keying the branch off it keeps the src type-safe. -->
                <iframe
                  v-if="video.embedUrl"
                  :src="video.embedUrl"
                  class="h-full w-full"
                  frameborder="0"
                  allowfullscreen
                  allow="autoplay; encrypted-media"
                  :title="video.label"
                />
                <video
                  v-else-if="video.display === 'file'"
                  :src="video.url"
                  controls
                  class="h-full w-full"
                />
                <!-- Neither embeddable nor a playable file: a <video> here
                     would render controls that can never play anything, so
                     link out instead and name the host being opened. -->
                <a
                  v-else
                  :href="video.url"
                  target="_blank"
                  rel="noopener"
                  class="hover:bg-muted/40 flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm transition-colors"
                >
                  <Play class="text-muted-foreground h-6 w-6" />
                  <span class="underline">{{ linkHost(video.url) }}</span>
                </a>
              </div>
            </div>
          </div>
          <div
            v-if="documentItems.length"
            class="grid gap-3 sm:grid-cols-2"
            data-testid="product-documents"
          >
            <a
              v-for="(doc, idx) in documentItems"
              :key="`${doc.url}:${idx}`"
              :href="doc.url"
              target="_blank"
              rel="noopener"
              class="border-border hover:bg-muted/40 flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors"
            >
              <component
                :is="documentIcon(doc.fileType)"
                class="text-muted-foreground h-5 w-5 shrink-0"
              />
              <span class="truncate">{{ doc.label }}</span>
            </a>
          </div>
        </div>
        <p v-else class="text-muted-foreground text-sm">
          {{ $t('product.no_documents') }}
        </p>
      </TabsContent>

      <TabsContent
        v-if="hasRelated"
        value="related"
        data-print="related"
        class="bg-card mt-6 rounded-lg border p-6"
      >
        <h3 class="font-heading mb-4 text-2xl font-bold">
          {{ $t('product.related') }}
        </h3>
        <RelatedProducts :products="related ?? []" :hide-heading="true" />
      </TabsContent>
    </Tabs>

    <!-- Mobile: Accordion (hidden at md+ via CSS to avoid SSR/client flash).
         Print uses the desktop tabs branch (md+ media query active in the
         print preview), so this accordion stays hidden when printing. -->
    <Accordion v-if="hasAnyTab" class="md:hidden print:hidden" type="multiple">
      <AccordionItem v-if="hasDescription" value="description">
        <AccordionTrigger>{{ $t('product.details') }}</AccordionTrigger>
        <AccordionContent>
          <!-- eslint-disable vue/no-v-html -->
          <div class="max-w-3xl space-y-6">
            <div
              v-if="detailsText2"
              class="prose max-w-none"
              v-html="detailsText2"
            />
            <div
              v-if="detailsText3"
              class="prose max-w-none"
              v-html="detailsText3"
            />
          </div>
          <!-- eslint-enable vue/no-v-html -->
        </AccordionContent>
      </AccordionItem>

      <AccordionItem v-if="hasSpecs" value="specifications">
        <AccordionTrigger>{{ $t('product.specifications') }}</AccordionTrigger>
        <AccordionContent>
          <div class="flex flex-col gap-4">
            <div
              v-for="group in visibleGroups"
              :key="group.name ?? group.parameterGroupId"
              class="flex flex-col gap-2"
            >
              <h4 class="text-sm font-semibold">{{ group.name }}</h4>
              <table class="w-full text-sm" data-testid="spec-table">
                <tbody>
                  <tr
                    v-for="(param, idx) in group.parameters"
                    :key="param.identifier ?? param.name ?? idx"
                    class="border-border border-b"
                  >
                    <td class="text-muted-foreground py-2 pr-4">
                      {{ param.label || param.name || '' }}
                    </td>
                    <td class="py-2">{{ param.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="documents">
        <AccordionTrigger>{{ $t('product.documents') }}</AccordionTrigger>
        <AccordionContent>
          <div v-if="hasDocumentsContent" class="flex flex-col gap-6">
            <div v-if="videoItems.length" class="flex flex-col gap-4">
              <div
                v-for="(video, idx) in videoItems"
                :key="`${video.url}:${idx}`"
                class="flex flex-col gap-2"
              >
                <p class="text-sm font-medium">{{ video.label }}</p>
                <div
                  class="border-border aspect-video w-full overflow-hidden rounded-lg border"
                >
                  <iframe
                    v-if="video.embedUrl"
                    :src="video.embedUrl"
                    class="h-full w-full"
                    frameborder="0"
                    allowfullscreen
                    allow="autoplay; encrypted-media"
                    :title="video.label"
                  />
                  <video
                    v-else
                    :src="video.url"
                    controls
                    class="h-full w-full"
                  />
                </div>
              </div>
            </div>
            <div v-if="documentItems.length" class="flex flex-col gap-3">
              <a
                v-for="(doc, idx) in documentItems"
                :key="`${doc.url}:${idx}`"
                :href="doc.url"
                target="_blank"
                rel="noopener"
                class="border-border hover:bg-muted/40 flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors"
              >
                <FileText class="text-muted-foreground h-5 w-5 shrink-0" />
                <span class="truncate">{{ doc.label }}</span>
              </a>
            </div>
          </div>
          <p v-else class="text-muted-foreground text-sm">
            {{ $t('product.no_documents') }}
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem v-if="hasRelated" value="related">
        <AccordionTrigger>{{ $t('product.related') }}</AccordionTrigger>
        <AccordionContent>
          <RelatedProducts :products="related ?? []" :hide-heading="true" />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>
</template>

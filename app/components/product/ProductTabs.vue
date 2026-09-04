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
import { FileText } from 'lucide-vue-next';
import {
  classifyMediaParameter,
  type ProductMediaParameter,
} from '#shared/constants/product-media';

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
const { productMediaParameters } = useTenant();
const classifiedParameters = computed(() => {
  const videos: ProductMediaParameter[] = [];
  const documents: ProductMediaParameter[] = [];
  const mediaKeys = new Set<string>();
  for (const group of props.product.parameterGroups ?? []) {
    for (const param of group.parameters ?? []) {
      const media = classifyMediaParameter(param, productMediaParameters.value);
      if (!media) continue;
      mediaKeys.add(`${group.parameterGroupId}:${param.name}`);
      (media.kind === 'video' ? videos : documents).push(media);
    }
  }
  return { videos, documents, mediaKeys };
});
const videoItems = computed(() => classifiedParameters.value.videos);
const documentItems = computed(() => classifiedParameters.value.documents);
const hasDocumentsContent = computed(
  () => videoItems.value.length > 0 || documentItems.value.length > 0,
);

const HIDDEN_PARAMETER_GROUPS = /^monitor$/i;
const visibleGroups = computed(() =>
  (props.product.parameterGroups ?? [])
    .filter((g) => !HIDDEN_PARAMETER_GROUPS.test(g.name ?? ''))
    .map((g) => ({
      ...g,
      parameters: (g.parameters ?? []).filter(
        (p) =>
          (p.name || p.label) &&
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
    <Tabs class="hidden md:block" :default-value="defaultTab">
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
            <p
              v-if="group.parameters?.[0]?.description"
              class="text-muted-foreground text-sm"
            >
              {{ group.parameters[0].description }}
            </p>
            <table class="w-full text-sm" data-testid="spec-table">
              <tbody>
                <tr
                  v-for="(param, idx) in group.parameters"
                  :key="param.identifier ?? param.name ?? idx"
                  class="border-border odd:bg-muted/40 border-b"
                >
                  <td class="text-muted-foreground px-3 py-3 pr-4">
                    {{ param.name ?? param.label ?? '' }}
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
              v-for="video in videoItems"
              :key="video.url"
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
                <video v-else :src="video.url" controls class="h-full w-full" />
              </div>
            </div>
          </div>
          <div
            v-if="documentItems.length"
            class="grid gap-3 sm:grid-cols-2"
            data-testid="product-documents"
          >
            <a
              v-for="doc in documentItems"
              :key="doc.url"
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
    <Accordion class="md:hidden print:hidden" type="multiple">
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
                      {{ param.name ?? param.label ?? '' }}
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
                v-for="video in videoItems"
                :key="video.url"
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
                v-for="doc in documentItems"
                :key="doc.url"
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

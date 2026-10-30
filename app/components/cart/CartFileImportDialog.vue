<script setup lang="ts">
import {
  CircleAlert,
  CircleCheck,
  Download,
  LoaderCircle,
  Trash2,
} from 'lucide-vue-next';
import { useBase64 } from '@vueuse/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { useCartStore } from '~/stores/cart';
import {
  CART_IMPORT_EXTENSIONS,
  CART_IMPORT_MAX_FILE_BYTES,
  CART_IMPORT_MAX_QUANTITY,
  CART_IMPORT_MAX_ROWS,
} from '#shared/constants/cart-import';
import type {
  CartImportAddFailure,
  CartImportAddResult,
  CartImportFileError,
  CartImportLine,
  CartImportPreview,
  CartImportProblem,
  CartImportProblemReason,
} from '#shared/types/cart-import';

/**
 * Upload an order file, check what it resolves to, then add it to the cart.
 * Three steps in one dialog: choose a file, review the matched lines and the
 * rows that will not be added, and read the outcome. Nothing reaches the cart
 * before the buyer presses the add button, and only matched lines are sent.
 */

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const cartStore = useCartStore();
const { showPrice } = usePriceVisibility();
const { showIncVat } = useVatDisplay();

type Step = 'select' | 'preview' | 'result';
type ReadyPreview = Extract<CartImportPreview, { status: 'ok' }>;

/** Problem groups in the order a buyer should fix them. */
const REASON_ORDER: CartImportProblemReason[] = [
  'not_found',
  'variant_required',
  'out_of_stock',
  'insufficient_stock',
  'invalid_quantity',
  'quantity_too_large',
  'missing_article_number',
  'article_number_altered',
];

const inputId = useId();
const helpId = useId();
const step = ref<Step>('select');
const busy = ref<'reading' | 'adding' | null>(null);
const error = ref<string | null>(null);
const preview = ref<ReadyPreview | null>(null);
const lines = ref<CartImportLine[]>([]);
const outcome = ref<Pick<CartImportAddResult, 'added' | 'failed'> | null>(null);
const heading = ref<HTMLElement | null>(null);
const table = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
/** The cart the preview counted from; undefined means a new cart. */
const previewCartId = ref<string | undefined>();
/** Bumped on every reset, so a reply to an earlier opening is dropped. */
let generation = 0;
/** Polite announcements for progress that focus does not move to. */
const status = ref('');
watch(busy, (value) => {
  if (value === 'reading') status.value = t('cart.file_import.reading');
  else if (value === 'adding') status.value = t('cart.file_import.adding');
});

const file = shallowRef<File>();
const { base64, promise: reading } = useBase64(file, { dataUrl: false });

const accept = CART_IMPORT_EXTENSIONS.join(',');

const templateHref = computed(() => {
  const header = `${t('cart.file_import.template_article_header')};${t('cart.file_import.template_quantity_header')}\r\n`;
  // A byte-order mark makes Excel read the file as UTF-8.
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${header}`)}`;
});

watch(open, (isOpen) => {
  if (isOpen) reset();
});

function reset() {
  generation += 1;
  step.value = 'select';
  busy.value = null;
  file.value = undefined;
  error.value = null;
  preview.value = null;
  previewCartId.value = undefined;
  lines.value = [];
  outcome.value = null;
}

function focusHeading() {
  nextTick(() => heading.value?.focus());
}

function fileErrorMessage(code: CartImportFileError): string {
  return t(`cart.file_import.errors.${code}`, { max: CART_IMPORT_MAX_ROWS });
}

function requestErrorMessage(failure: unknown, fallback: string): string {
  const status =
    failure && typeof failure === 'object' && 'statusCode' in failure
      ? Number((failure as { statusCode?: unknown }).statusCode)
      : 0;
  if (status === 413) return fileErrorMessage('file_too_large');
  if (status === 429) return t('cart.file_import.errors.rate_limited');
  if (status === 403) return t('cart.file_import.errors.not_available');
  return t(`cart.file_import.errors.${fallback}`);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const chosen = input.files?.[0];
  // Cleared so the same file can be chosen again once it is fixed.
  input.value = '';
  if (!chosen) return;

  error.value = null;
  const extensions: readonly string[] = CART_IMPORT_EXTENSIONS;
  if (!extensions.includes(extensionOf(chosen.name))) {
    error.value = fileErrorMessage('unsupported_format');
    return;
  }
  if (chosen.size === 0) {
    error.value = fileErrorMessage('empty_file');
    return;
  }
  if (chosen.size > CART_IMPORT_MAX_FILE_BYTES) {
    error.value = fileErrorMessage('file_too_large');
    return;
  }

  const current = generation;
  const cartId = cartStore.cartId || undefined;
  busy.value = 'reading';
  try {
    file.value = chosen;
    // useBase64 starts reading the new file on its next watcher flush.
    await nextTick();
    await reading.value;
    const result = await $fetch<CartImportPreview>('/api/cart/import/preview', {
      method: 'POST',
      body: { fileName: chosen.name, content: base64.value, cartId },
    });
    if (current !== generation) return;
    if (result.status === 'invalid') {
      error.value = fileErrorMessage(result.error);
      return;
    }
    preview.value = result;
    previewCartId.value = result.newCart ? undefined : cartId;
    lines.value = [...result.lines];
    step.value = 'preview';
    focusHeading();
  } catch (failure) {
    if (current !== generation) return;
    error.value = requestErrorMessage(failure, 'upload_failed');
  } finally {
    if (current === generation) {
      busy.value = null;
      file.value = undefined;
      // The input was disabled while reading, which dropped its focus.
      if (error.value) nextTick(() => fileInput.value?.focus());
    }
  }
}

function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

const columnsNote = computed(() => {
  const columns = preview.value?.columns;
  if (!columns) return '';
  const letters = {
    article: columnLetter(columns.article),
    quantity: columnLetter(columns.quantity),
  };
  return columns.headerRecognized
    ? t('cart.file_import.columns_recognized', letters)
    : t('cart.file_import.columns_assumed', letters);
});

const skippedHeadingRow = computed(() => {
  const columns = preview.value?.columns;
  return columns && !columns.headerRecognized ? columns.headerRow : null;
});

const problemGroups = computed(() => {
  const problems = preview.value?.problems ?? [];
  return REASON_ORDER.map((reason) => ({
    reason,
    problems: problems.filter((problem) => problem.reason === reason),
  })).filter((group) => group.problems.length);
});

const problemCount = computed(
  () => preview.value?.problems.reduce((sum, p) => sum + p.rows.length, 0) ?? 0,
);

const showPriceColumn = computed(
  () => showPrice.value && lines.value.some((line) => line.unitPrice),
);
const showStockColumn = computed(() =>
  lines.value.some((line) => line.stockStatus),
);

function priceOf(line: CartImportLine): string {
  const price = line.unitPrice;
  if (!price) return '';
  return (
    (showIncVat.value
      ? price.sellingPriceIncVatFormatted
      : price.sellingPriceExVatFormatted) ?? ''
  );
}

function rowsLabel(rows: number[]): string {
  return t(
    'cart.file_import.row_label',
    { rows: rows.join(', ') },
    rows.length,
  );
}

function reasonLabel(reason: CartImportProblemReason): string {
  return t(`cart.file_import.reasons.${reason}`, {
    max: CART_IMPORT_MAX_QUANTITY,
  });
}

function problemDetail(problem: CartImportProblem): string {
  const parts = [problem.articleNumber, problem.name].filter(Boolean);
  if (problem.quantity !== undefined && problem.reason !== 'not_found') {
    parts.push(
      t('cart.file_import.quantity_value', {
        quantity: problem.quantity || '—',
      }),
    );
  }
  return parts.join(' · ');
}

function failureLabel(reason: CartImportAddFailure): string {
  return t(`cart.file_import.add_failures.${reason}`, {
    max: CART_IMPORT_MAX_QUANTITY,
  });
}

function removeLine(index: number) {
  const removed = lines.value[index];
  lines.value.splice(index, 1);
  nextTick(() => {
    const buttons =
      table.value?.querySelectorAll<HTMLButtonElement>(
        'button[data-remove-line]',
      ) ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else heading.value?.focus();
  });
  if (removed) {
    status.value = t('cart.file_import.line_removed', {
      article: removed.articleNumber,
    });
  }
}

async function addToCart() {
  if (!lines.value.length || busy.value) return;
  busy.value = 'adding';
  error.value = null;
  try {
    outcome.value = await cartStore.importItems(
      lines.value.map(({ skuId, quantity, articleNumber, inCartQuantity }) => ({
        skuId,
        quantity,
        articleNumber,
        inCartQuantity,
      })),
      previewCartId.value,
    );
    step.value = 'result';
    focusHeading();
  } catch (failure) {
    error.value = requestErrorMessage(failure, 'add_failed');
  } finally {
    busy.value = null;
  }
}

function chooseAnother() {
  reset();
  focusHeading();
}

function onOpenChange(value: boolean) {
  // Closing mid-add would hide the outcome of a request still running.
  if (!value && busy.value === 'adding') return;
  open.value = value;
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      class="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
      data-testid="cart-file-import-dialog"
      :aria-busy="busy !== null"
    >
      <DialogHeader>
        <DialogTitle>{{ t('cart.file_import.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('cart.file_import.description') }}
        </DialogDescription>
      </DialogHeader>

      <p
        class="sr-only"
        aria-live="polite"
        data-testid="cart-file-import-status"
      >
        {{ status }}
      </p>

      <!-- Step 1: choose a file -->
      <section v-if="step === 'select'" class="space-y-4">
        <h3
          ref="heading"
          tabindex="-1"
          class="text-base font-semibold outline-none"
        >
          {{ t('cart.file_import.format_heading') }}
        </h3>
        <p :id="helpId" class="text-muted-foreground text-sm">
          {{
            t('cart.file_import.format_help', {
              max: CART_IMPORT_MAX_ROWS,
            })
          }}
        </p>
        <a
          :href="templateHref"
          :download="t('cart.file_import.template_filename')"
          class="text-primary inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
          data-testid="cart-file-import-template"
        >
          <Download class="size-4" aria-hidden="true" />
          {{ t('cart.file_import.template_link') }}
        </a>

        <div class="space-y-2">
          <label :for="inputId" class="block text-sm font-medium">
            {{ t('cart.file_import.choose_file') }}
          </label>
          <input
            :id="inputId"
            ref="fileInput"
            type="file"
            :accept="accept"
            :aria-describedby="helpId"
            :aria-invalid="error ? 'true' : undefined"
            :disabled="busy !== null"
            class="border-input file:bg-secondary file:text-secondary-foreground focus-visible:ring-ring/50 block w-full rounded-md border text-sm file:mr-3 file:border-0 file:px-3 file:py-2 file:font-medium focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-50"
            data-testid="cart-file-import-input"
            @change="onFileChange"
          />
        </div>

        <p
          v-if="busy === 'reading'"
          class="text-muted-foreground flex items-center gap-2 text-sm"
        >
          <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
          {{ t('cart.file_import.reading') }}
        </p>
      </section>

      <!-- Step 2: review -->
      <section
        v-else-if="step === 'preview' && preview"
        class="space-y-5"
        data-testid="cart-file-import-preview"
      >
        <div class="space-y-1">
          <h3
            ref="heading"
            tabindex="-1"
            class="text-base font-semibold outline-none"
          >
            {{
              t(
                'cart.file_import.preview_summary',
                { count: lines.length },
                lines.length,
              )
            }}
          </h3>
          <p class="text-muted-foreground text-sm">{{ columnsNote }}</p>
          <p
            v-if="preview?.newCart"
            class="text-sm"
            data-testid="cart-file-import-new-cart"
          >
            {{ t('cart.file_import.new_cart') }}
          </p>
          <p
            v-if="skippedHeadingRow !== null"
            class="text-muted-foreground text-sm"
          >
            {{
              t('cart.file_import.heading_skipped', { row: skippedHeadingRow })
            }}
          </p>
        </div>

        <div v-if="lines.length" ref="table" class="overflow-x-auto">
          <table
            class="w-full text-left text-sm"
            data-testid="cart-file-import-lines"
          >
            <caption class="sr-only">
              {{
                t('cart.file_import.table_caption')
              }}
            </caption>
            <thead class="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" class="py-2 pr-3 font-medium">
                  {{ t('cart.file_import.col_article') }}
                </th>
                <th scope="col" class="py-2 pr-3 font-medium">
                  {{ t('cart.file_import.col_name') }}
                </th>
                <th scope="col" class="py-2 pr-3 text-right font-medium">
                  {{ t('cart.file_import.col_quantity') }}
                </th>
                <th
                  v-if="showPriceColumn"
                  scope="col"
                  class="py-2 pr-3 text-right font-medium"
                >
                  {{ t('cart.file_import.col_price') }}
                </th>
                <th
                  v-if="showStockColumn"
                  scope="col"
                  class="py-2 pr-3 font-medium"
                >
                  {{ t('cart.file_import.col_stock') }}
                </th>
                <th scope="col" class="py-2">
                  <span class="sr-only">{{
                    t('cart.file_import.col_remove')
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-border divide-y">
              <tr
                v-for="(line, index) in lines"
                :key="line.skuId"
                data-testid="cart-file-import-line"
              >
                <td class="py-2 pr-3 align-top font-mono text-xs">
                  {{ line.articleNumber }}
                </td>
                <td class="py-2 pr-3 align-top">
                  <span class="block">{{ line.name }}</span>
                  <span
                    v-if="line.inCartQuantity"
                    class="text-muted-foreground block text-xs"
                  >
                    {{
                      t('cart.file_import.in_cart', {
                        count: line.inCartQuantity,
                      })
                    }}
                  </span>
                </td>
                <td class="py-2 pr-3 text-right align-top tabular-nums">
                  {{ line.quantity }}
                </td>
                <td
                  v-if="showPriceColumn"
                  class="py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums"
                >
                  {{ priceOf(line) }}
                </td>
                <td v-if="showStockColumn" class="py-2 pr-3 align-top">
                  <StockBadge
                    v-if="line.stockStatus"
                    :status="line.stockStatus"
                    size="sm"
                  />
                </td>
                <td class="py-1 text-right align-top">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-remove-line
                    :aria-label="
                      t('cart.file_import.remove_line', {
                        article: line.articleNumber,
                      })
                    "
                    :disabled="busy !== null"
                    @click="removeLine(index)"
                  >
                    <Trash2 class="size-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="problemGroups.length"
          class="border-warning/30 bg-warning/5 space-y-3 rounded-md border p-4"
          data-testid="cart-file-import-problems"
        >
          <h4 class="flex items-center gap-2 text-sm font-semibold">
            <CircleAlert class="text-warning size-4" aria-hidden="true" />
            {{
              t(
                'cart.file_import.problems_summary',
                { count: problemCount },
                problemCount,
              )
            }}
          </h4>
          <div
            v-for="group in problemGroups"
            :key="group.reason"
            :data-testid="`cart-file-import-problem-${group.reason}`"
          >
            <h5 class="text-sm font-medium">{{ reasonLabel(group.reason) }}</h5>
            <ul class="text-muted-foreground mt-1 space-y-0.5 text-sm">
              <li
                v-for="problem in group.problems"
                :key="`${problem.rows.join('-')}-${problem.articleNumber}`"
              >
                <span class="text-foreground font-medium">{{
                  rowsLabel(problem.rows)
                }}</span>
                <template v-if="problemDetail(problem)">
                  — {{ problemDetail(problem) }}
                </template>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Step 3: outcome -->
      <section
        v-else-if="step === 'result' && outcome"
        class="space-y-4"
        data-testid="cart-file-import-result"
      >
        <h3
          ref="heading"
          tabindex="-1"
          class="flex items-center gap-2 text-base font-semibold outline-none"
        >
          <CircleCheck
            v-if="outcome.added.length"
            class="text-success size-5"
            aria-hidden="true"
          />
          {{
            outcome.added.length
              ? t(
                  'cart.file_import.result_added',
                  { count: outcome.added.length },
                  outcome.added.length,
                )
              : t('cart.file_import.result_none_added')
          }}
        </h3>
        <div
          v-if="outcome.failed.length"
          role="alert"
          class="border-destructive/30 bg-destructive/5 rounded-md border p-4"
          data-testid="cart-file-import-failed"
        >
          <p class="text-sm font-semibold">
            {{
              t(
                'cart.file_import.result_failed',
                { count: outcome.failed.length },
                outcome.failed.length,
              )
            }}
          </p>
          <ul class="mt-2 space-y-0.5 text-sm">
            <li v-for="item in outcome.failed" :key="item.skuId">
              <span class="font-mono text-xs">{{ item.articleNumber }}</span>
              — {{ failureLabel(item.reason) }}
            </li>
          </ul>
        </div>
      </section>

      <p
        v-if="error"
        role="alert"
        class="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        data-testid="cart-file-import-error"
      >
        {{ error }}
      </p>

      <DialogFooter v-if="step !== 'select'">
        <template v-if="step === 'preview'">
          <Button
            variant="outline"
            :disabled="busy !== null"
            data-testid="cart-file-import-another"
            @click="chooseAnother"
          >
            {{ t('cart.file_import.choose_another') }}
          </Button>
          <Button
            :disabled="!lines.length || busy !== null"
            data-testid="cart-file-import-add"
            @click="addToCart"
          >
            <LoaderCircle
              v-if="busy === 'adding'"
              class="size-4 animate-spin"
              aria-hidden="true"
            />
            {{
              busy === 'adding'
                ? t('cart.file_import.adding')
                : t(
                    'cart.file_import.add_button',
                    { count: lines.length },
                    lines.length,
                  )
            }}
          </Button>
        </template>
        <template v-else>
          <Button
            variant="outline"
            data-testid="cart-file-import-another"
            @click="chooseAnother"
          >
            {{ t('cart.file_import.upload_another') }}
          </Button>
          <Button data-testid="cart-file-import-close" @click="open = false">
            {{ t('common.close') }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

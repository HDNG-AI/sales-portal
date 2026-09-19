<script setup lang="ts">
import { z } from 'zod';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import type {
  ContentConfigType,
  FormWidgetData,
  FormWidgetField,
} from '#shared/types/cms';
import type { SupportedLocale } from '#shared/utils/locale-market';
import { getCountryOptions } from '~/utils/country-options';
import { buildMailto } from '~/utils/mailto';
import { safeLocationRedirect } from '~/utils/client-helpers';
import {
  HONEYPOT_FIELDS,
  FORM_STARTED_AT_FIELD,
  FORM_DURATION_FIELD,
} from '#shared/utils/form-post';

const props = defineProps<{
  data: FormWidgetData;
  config: ContentConfigType;
  layout: string;
}>();

const { t, locale } = useI18n();

// Computed so it reacts to locale changes without re-running on every render.
const countryOptions = computed(() =>
  getCountryOptions(locale.value as SupportedLocale),
);

const formValues = reactive<Record<string, string>>({});
// Checkbox values are kept apart from text: a group shares one name and holds
// several values, which the flat string map cannot express.
const checkedValues = reactive<Record<string, boolean>>({});
const honeypotValues = reactive<Record<string, string>>(
  Object.fromEntries(HONEYPOT_FIELDS.map((name) => [name, ''])),
);
// Client-side only: on the server there is no session to time, and a value
// rendered into HTML would be the same for every visitor anyway.
const startedAt = ref(0);
const submitting = ref(false);
const submitError = ref('');
const submitted = ref(false);
onMounted(() => {
  startedAt.value = Date.now();
});
const fieldErrors = reactive<Record<string, string>>({});
const touched = reactive<Record<string, boolean>>({});

// Initialise formValues when data resolves (SSR-safe: data may be null on first render).
watchEffect(() => {
  for (const field of props.data?.fields ?? []) {
    if (!(field.name in formValues)) {
      formValues[field.name] = '';
    }
  }
});

// Build schema map once per fields change; validateField looks up by name.
const fieldSchemaMap = computed(() => {
  const map: Record<string, z.ZodTypeAny> = {};
  for (const field of props.data?.fields ?? []) {
    if (field.type === 'checkbox') {
      // Validated on submit against checkedValues, not as a string.
      continue;
    }
    if (field.type === 'email') {
      // Apply email format validation regardless of required so partial fills
      // that contain an invalid address still show an error.
      if (field.required) {
        map[field.name] = z
          .string()
          .min(1, 'form.field_required')
          .email('form.invalid_email');
      } else {
        map[field.name] = z
          .string()
          .refine((v) => v === '' || z.string().email().safeParse(v).success, {
            message: 'form.invalid_email',
          });
      }
    } else if (field.required) {
      map[field.name] = z.string().min(1, 'form.field_required');
    } else {
      map[field.name] = z.string();
    }
  }
  return map;
});

function validateField(name: string) {
  const fieldSchema = fieldSchemaMap.value[name];
  if (!fieldSchema) return;
  const result = fieldSchema.safeParse(formValues[name] ?? '');
  if (result.success) {
    fieldErrors[name] = '';
  } else {
    fieldErrors[name] = result.error.issues[0]?.message ?? '';
  }
}

function handleBlur(name: string) {
  touched[name] = true;
  validateField(name);
}

function handleSelectChange(name: string, val: string) {
  formValues[name] = val;
  touched[name] = true;
  validateField(name);
}

function validateAll(): boolean {
  for (const field of props.data?.fields ?? []) {
    touched[field.name] = true;
    if (field.type === 'checkbox') {
      // A required checkbox means consent: it has to be ticked, and an
      // unticked one is an error rather than an empty value.
      fieldErrors[field.name] =
        field.required && !checkedValues[checkboxKey(field)]
          ? 'form.field_required'
          : '';
      continue;
    }
    validateField(field.name);
  }
  return Object.values(fieldErrors).every((v) => !v);
}

/**
 * Checkboxes sharing a `name` are one group, so state is keyed by name and
 * value together — otherwise ticking one would untick its siblings.
 */
function checkboxKey(field: FormWidgetField): string {
  return field.value ? `${field.name}:${field.value}` : field.name;
}

defineExpose({ formValues, fieldErrors, touched, handleSubmit, validateAll });

// Subject is configured per widget so each form (apply, contact, ...) owns its
// own. `{fieldName}` placeholders are filled from the submitted values, e.g.
// "Account application: {company}". When no subject is configured we fall back
// to the CMS template name, then a neutral default — never a hardcoded subject
// that would be wrong for a different form.
function resolveSubject(): string {
  const configured = props.data?.subject?.trim();
  if (configured) {
    return configured.replace(/\{(\w+)\}/g, (_match, name: string) =>
      (formValues[name] ?? '').trim(),
    );
  }
  return props.data?.templateName?.trim() || t('form.default_subject');
}

/** The values to submit, including the fields the receiver checks for spam. */
function collectSubmission(): Record<string, string | string[]> {
  const payload: Record<string, string | string[]> = {};

  for (const field of props.data?.fields ?? []) {
    if (field.type === 'checkbox') {
      if (!checkedValues[checkboxKey(field)]) continue;
      const value = field.value ?? 'on';
      const existing = payload[field.name];
      if (Array.isArray(existing)) existing.push(value);
      else if (typeof existing === 'string')
        payload[field.name] = [existing, value];
      else payload[field.name] = value;
      continue;
    }
    payload[field.name] = formValues[field.name] ?? '';
  }

  for (const name of HONEYPOT_FIELDS)
    payload[name] = honeypotValues[name] ?? '';
  payload[FORM_STARTED_AT_FIELD] = String(startedAt.value);
  payload[FORM_DURATION_FIELD] = String(Date.now() - startedAt.value);

  return payload;
}

async function handleSubmit() {
  if (submitting.value) return;
  if (!validateAll()) return;

  const postUrl = props.data?.postUrl;
  const payload = collectSubmission();

  if (!postUrl) {
    const url = buildMailto({
      recipient: props.data?.sendFormToEmail ?? '',
      subject: resolveSubject(),
      fields: (props.data?.fields ?? []).map((f: FormWidgetField) => ({
        label: f.label,
        value: String(payload[f.name] ?? ''),
      })),
    });
    safeLocationRedirect(url);
    return;
  }

  // Only the honeypot is worth checking here, and only on this path. A filled
  // honeypot is never a person, so dropping it costs nothing. Timing is left
  // to the receiver on purpose: bailing on a fast submit would silently
  // discard a real person's form for typing quickly, and the receiver already
  // refuses anything under its own threshold. Nothing is checked on the
  // mailto path at all — that opens the sender's own mail client, so there is
  // no one to spam.
  if (HONEYPOT_FIELDS.some((name) => (honeypotValues[name] ?? '').trim())) {
    submitted.value = true;
    return;
  }

  submitting.value = true;
  submitError.value = '';
  try {
    // Posted through our own server: it holds the allowlist the CMS cannot
    // reach, and keeps the CSP's connect-src at 'self'.
    await $fetch('/api/cms/form-submit', {
      method: 'POST',
      body: { postUrl, fields: payload },
    });
    submitted.value = true;
  } catch {
    submitError.value = 'form.submit_failed';
  } finally {
    submitting.value = false;
  }
}

// Derive the options for a select field: prefer CMS-supplied options when
// non-empty; fall back to locale-aware country list.
function selectOptionsFor(field: FormWidgetField) {
  if (field.options && field.options.length > 0) {
    return field.options;
  }
  return countryOptions.value;
}
</script>

<template>
  <p v-if="submitted" class="text-sm" role="status" data-testid="form-success">
    {{ t('form.submit_success') }}
  </p>

  <form
    v-else
    class="max-w-lg space-y-4"
    data-testid="form-widget"
    @submit.prevent="handleSubmit"
  >
    <div
      v-for="field in data?.fields ?? []"
      :key="field.name"
      class="space-y-2"
      :data-testid="`form-field-${field.name}`"
    >
      <Label
        v-if="field.type !== 'checkbox'"
        :for="`form-field-input-${field.name}`"
      >
        {{ field.label }}
        <span
          v-if="field.required"
          class="text-destructive ms-0.5"
          aria-hidden="true"
          >*</span
        >
      </Label>

      <!-- Checkbox: standalone consent, or one of a group sharing a name -->
      <template v-if="field.type === 'checkbox'">
        <label class="flex items-start gap-2 text-sm">
          <input
            :id="`form-field-input-${field.name}`"
            v-model="checkedValues[checkboxKey(field)]"
            type="checkbox"
            class="border-input accent-primary mt-0.5 size-4 rounded border"
            :aria-invalid="
              touched[field.name] && !!fieldErrors[field.name]
                ? 'true'
                : undefined
            "
            :aria-required="field.required ? 'true' : undefined"
          />
          <span>
            {{ field.label }}
            <span
              v-if="field.required"
              class="text-destructive ms-0.5"
              aria-hidden="true"
              >*</span
            >
          </span>
        </label>
      </template>

      <!-- Select field -->
      <template v-else-if="field.type === 'select'">
        <Select
          :model-value="formValues[field.name] ?? ''"
          @update:model-value="
            (val) => handleSelectChange(field.name, String(val ?? ''))
          "
        >
          <SelectTrigger
            :id="`form-field-input-${field.name}`"
            class="w-full"
            :aria-invalid="
              touched[field.name] && !!fieldErrors[field.name]
                ? 'true'
                : undefined
            "
            :aria-describedby="
              touched[field.name] && fieldErrors[field.name]
                ? `form-field-${field.name}-error`
                : undefined
            "
            :aria-required="field.required ? 'true' : undefined"
          >
            <SelectValue :placeholder="t('form.country_placeholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in selectOptionsFor(field)"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </template>

      <!-- Textarea field -->
      <template v-else-if="field.type === 'textarea'">
        <textarea
          :id="`form-field-input-${field.name}`"
          v-model="formValues[field.name]"
          class="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-[80px] w-full rounded-md border bg-white px-3 py-2 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          :aria-invalid="
            touched[field.name] && !!fieldErrors[field.name]
              ? 'true'
              : undefined
          "
          :aria-describedby="
            touched[field.name] && fieldErrors[field.name]
              ? `form-field-${field.name}-error`
              : undefined
          "
          :aria-required="field.required ? 'true' : undefined"
          @blur="handleBlur(field.name)"
        />
      </template>

      <!-- Input (text or email) -->
      <template v-else>
        <Input
          :id="`form-field-input-${field.name}`"
          v-model="formValues[field.name]"
          :type="field.type === 'email' ? 'email' : 'text'"
          :aria-invalid="
            touched[field.name] && !!fieldErrors[field.name]
              ? 'true'
              : undefined
          "
          :aria-describedby="
            touched[field.name] && fieldErrors[field.name]
              ? `form-field-${field.name}-error`
              : undefined
          "
          :aria-required="field.required ? 'true' : undefined"
          @blur="handleBlur(field.name)"
        />
      </template>

      <p
        v-if="touched[field.name] && fieldErrors[field.name]"
        :id="`form-field-${field.name}-error`"
        class="text-destructive text-xs"
        role="alert"
        :data-testid="`form-field-${field.name}-error`"
      >
        {{ t(fieldErrors[field.name] ?? '') }}
      </p>
    </div>

    <!-- Never shown and never focusable: anything in these came from
         something filling inputs indiscriminately. Checked by the receiver. -->
    <div class="hidden" aria-hidden="true">
      <input
        v-for="name in HONEYPOT_FIELDS"
        :key="name"
        v-model="honeypotValues[name]"
        :name="name"
        type="text"
        tabindex="-1"
        autocomplete="off"
      />
    </div>

    <p
      v-if="submitError"
      class="text-destructive text-sm"
      role="alert"
      data-testid="form-error"
    >
      {{ t(submitError) }}
    </p>

    <div class="border-border flex flex-col items-start gap-3 border-t pt-4">
      <Button type="submit" :disabled="submitting" data-testid="form-submit">
        {{ data?.submitLabel?.trim() || t('form.submit') }}
      </Button>

      <p
        v-if="data?.sendFormToEmail"
        class="text-muted-foreground text-sm"
        data-testid="form-fallback"
      >
        <i18n-t keypath="form.fallback_email" tag="span">
          <template #recipient>
            <a
              :href="`mailto:${data.sendFormToEmail}`"
              class="text-primary underline underline-offset-2"
              >{{ data.sendFormToEmail }}</a
            >
          </template>
        </i18n-t>
      </p>
    </div>
  </form>
</template>

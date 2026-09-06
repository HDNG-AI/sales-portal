/**
 * Default parameter-name → media-kind mapping, used when a tenant hasn't
 * configured its own via `tenant.productMediaParameters` (see
 * shared/types/tenant-config.ts). Mirrors the `cms.slots`/`cms.menus`
 * pattern in shared/types/cms-slots.ts: parameter naming is decided by
 * whichever backend feeds a tenant's product data (PIM / merchant admin),
 * and Geins admin lets each merchant name their own parameters freely —
 * hardcoding one naming convention here would break any tenant whose PIM
 * calls the same concept something else (`Datasheet` instead of `Manual`,
 * for example). This table is only the seed every tenant starts from;
 * `classifyMediaParameter` always takes the tenant's resolved table
 * (defaults merged with that tenant's overrides, computed server-side in
 * server/utils/tenant.ts and delivered via PublicTenantConfig) as an
 * explicit argument rather than reading this constant directly.
 *
 * Matching is exact (case-insensitive) against a parameter's technical
 * `name`, never its localized `label` — the merchant admin this was
 * modeled on leaves `label` equal to `name` for these anyway, treating
 * them as keys rather than display text.
 *
 * A name match alone is not enough: `classifyMediaParameter` also requires
 * the value to look like a URL, so a parameter like `ProductSpec` that's
 * sometimes filled with plain text instead of a link falls through to a
 * normal spec row automatically.
 */
export const PRODUCT_MEDIA_PARAMETER_DEFAULTS: Record<
  string,
  'video' | 'document'
> = {
  videourl: 'video',
  manual: 'document',
  productspec: 'document',
};

export type ProductMediaKind = 'video' | 'document';

export interface ProductMediaParameter {
  kind: ProductMediaKind;
  label: string;
  url: string;
  /** Iframe-embeddable URL for known video providers; null for a direct file link (e.g. .mp4). */
  embedUrl: string | null;
}

const URL_PATTERN = /^https?:\/\//i;

function isUrlValue(value: string | undefined): value is string {
  return !!value && URL_PATTERN.test(value.trim());
}

/** Turns a PascalCase/camelCase technical key into a spaced display label. */
function formatParameterLabel(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a raw video URL to an embeddable iframe src for known providers.
 * Returns null for anything else (e.g. a direct .mp4 link), which callers
 * should render with a native <video> element instead.
 */
export function resolveVideoEmbedUrl(url: string): string | null {
  const youtubeMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/,
  );
  if (youtubeMatch?.[1]) {
    return `https://www.youtube.com/embed/${youtubeMatch[1]}`;
  }
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch?.[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }
  return null;
}

/**
 * Classifies a product parameter as video/document media, or returns null
 * when it isn't one — either its name isn't in `parameters`, or its value
 * doesn't look like a URL.
 *
 * @param parameters - The tenant's resolved name→kind table (defaults
 *   merged with that tenant's own overrides). Falls back to
 *   PRODUCT_MEDIA_PARAMETER_DEFAULTS when omitted, for callers that don't
 *   have tenant context (e.g. standalone tests).
 */
export function classifyMediaParameter(
  param: {
    name?: string;
    label?: string;
    value?: string;
  },
  parameters: Record<
    string,
    ProductMediaKind
  > = PRODUCT_MEDIA_PARAMETER_DEFAULTS,
): ProductMediaParameter | null {
  const key = param.name?.trim().toLowerCase();
  if (!key) return null;

  const kind = parameters[key];
  if (!kind || !isUrlValue(param.value)) return null;

  const url = param.value.trim();
  return {
    kind,
    label: formatParameterLabel(param.label || param.name || ''),
    url,
    embedUrl: kind === 'video' ? resolveVideoEmbedUrl(url) : null,
  };
}

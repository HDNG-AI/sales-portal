/**
 * Maps known product-parameter names to a media kind.
 *
 * Parameter naming is decided entirely by whichever backend feeds tenant
 * product data (PIM / merchant admin) — this table is the single place
 * where a new naming convention gets added as new backends or tenants are
 * onboarded. Matching is exact (case-insensitive) against the parameter's
 * technical `name`, never its localized `label` — the merchant admin this
 * was modeled on leaves `label` equal to `name` for these anyway, treating
 * them as keys rather than display text.
 *
 * A name match alone is not enough: `classifyMediaParameter` also requires
 * the value to look like a URL, so a parameter like `ProductSpec` that's
 * sometimes filled with plain text instead of a link falls through to a
 * normal spec row automatically.
 */
export const PRODUCT_MEDIA_PARAMETERS: Record<string, 'video' | 'document'> = {
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
 * when it isn't one — either its name isn't in the known table, or its
 * value doesn't look like a URL.
 */
export function classifyMediaParameter(param: {
  name?: string;
  label?: string;
  value?: string;
}): ProductMediaParameter | null {
  const key = param.name?.trim().toLowerCase();
  if (!key) return null;

  const kind = PRODUCT_MEDIA_PARAMETERS[key];
  if (!kind || !isUrlValue(param.value)) return null;

  const url = param.value.trim();
  return {
    kind,
    label: formatParameterLabel(param.label || param.name || ''),
    url,
    embedUrl: kind === 'video' ? resolveVideoEmbedUrl(url) : null,
  };
}

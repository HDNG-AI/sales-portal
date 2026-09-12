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

/**
 * Separator for a parameter holding several files (two manuals, a spec
 * sheet plus a CAD drawing). RFC 3986 excludes `|` from the characters a
 * URL may carry unencoded — it has to appear as `%7C` — so splitting on it
 * can never cut a well-formed URL in half, which is why it's preferred
 * over a comma or semicolon here.
 */
const MULTI_VALUE_SEPARATOR = '|';

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
 * Classifies one product parameter into the media entries it carries.
 *
 * Returns an entry per URL in the value, so a parameter holding several
 * files (see MULTI_VALUE_SEPARATOR) yields several, and one holding a
 * single URL yields exactly one. Returns an empty array when the parameter
 * isn't media at all — its name isn't in `parameters`, or no piece of its
 * value is URL-shaped — which is also what makes "no video configured"
 * render as nothing rather than an empty player.
 *
 * Pieces are validated individually, so a value that's part URLs and part
 * prose contributes the URLs it does have instead of being discarded
 * whole.
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
): ProductMediaParameter[] {
  const key = param.name?.trim().toLowerCase();
  if (!key) return [];

  const kind = parameters[key];
  if (!kind || !param.value) return [];

  const label = formatParameterLabel(param.label || param.name || '');

  return param.value
    .split(MULTI_VALUE_SEPARATOR)
    .map((piece) => piece.trim())
    .filter(isUrlValue)
    .map((url) => ({
      kind,
      label,
      url,
      embedUrl: kind === 'video' ? resolveVideoEmbedUrl(url) : null,
    }));
}

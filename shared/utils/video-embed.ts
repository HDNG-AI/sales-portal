/**
 * The one place that decides which video players the storefront may frame.
 *
 * Every iframe src is built here from a provider and a validated id; nothing
 * from a merchant (CMS widget, product parameter) reaches `src` verbatim. The
 * same origin list feeds the CSP `frame-src` and the `fullscreen` permission in
 * `nuxt.config.ts`, so the policy and the player can never drift apart.
 *
 * YouTube is framed from its privacy-enhanced host, which sets no cookies until
 * the visitor starts playback; Vimeo gets `dnt=1` for the same reason.
 */

export type VideoProvider = 'youtube' | 'vimeo';

/** Origins the CSP lets the storefront frame, beyond 'self'. */
export const VIDEO_FRAME_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
] as const;

/** YouTube ids are 11 characters of the URL-safe base64 alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Vimeo ids are numeric. */
const VIMEO_ID = /^\d{1,12}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/** Path prefixes on YouTube hosts whose next segment is the video id. */
const YOUTUBE_ID_PATHS = ['embed', 'shorts', 'live', 'v'];

export function isValidVideoId(provider: VideoProvider, id: string): boolean {
  return provider === 'youtube' ? YOUTUBE_ID.test(id) : VIMEO_ID.test(id);
}

/**
 * Builds the player URL for a provider and id, or null when the id is not one
 * the provider could have issued. The id is validated rather than encoded, so
 * a value carrying a path, query or script never produces a src at all.
 */
export function buildVideoEmbedUrl(
  provider: VideoProvider,
  id: string,
): string | null {
  const trimmed = id.trim();
  if (!isValidVideoId(provider, trimmed)) return null;
  return provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${trimmed}`
    : `https://player.vimeo.com/video/${trimmed}?dnt=1`;
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Finds the provider and id in a page or player URL a merchant pasted.
 * Only the exact provider hosts count: `youtube.com.example.net` or a
 * YouTube URL tucked into another site's query string is not a video.
 */
export function parseVideoUrl(
  raw: string,
): { provider: VideoProvider; id: string } | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | undefined;
    if (host === 'youtu.be') {
      id = segments[0];
    } else if (segments[0] === 'watch') {
      id = url.searchParams.get('v') ?? undefined;
    } else if (segments[0] && YOUTUBE_ID_PATHS.includes(segments[0])) {
      id = segments[1];
    }
    return id && isValidVideoId('youtube', id)
      ? { provider: 'youtube', id }
      : null;
  }

  if (VIMEO_HOSTS.has(host)) {
    // vimeo.com/<id> and player.vimeo.com/video/<id>
    const id = host === 'player.vimeo.com' ? segments[1] : segments[0];
    if (host === 'player.vimeo.com' && segments[0] !== 'video') return null;
    return id && isValidVideoId('vimeo', id) ? { provider: 'vimeo', id } : null;
  }

  return null;
}

/** A pasted video URL as an embeddable player src, or null. */
export function resolveVideoUrlToEmbed(raw: string): string | null {
  const parsed = parseVideoUrl(raw);
  return parsed ? buildVideoEmbedUrl(parsed.provider, parsed.id) : null;
}

/** The provider an allowlisted player src belongs to. */
export function videoProviderOf(embedUrl: string): VideoProvider | null {
  const url = parseHttpUrl(embedUrl);
  if (!url) return null;
  if (url.origin === 'https://www.youtube-nocookie.com') return 'youtube';
  if (url.origin === 'https://player.vimeo.com') return 'vimeo';
  return null;
}

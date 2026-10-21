import { describe, it, expect } from 'vitest';
import {
  VIDEO_FRAME_ORIGINS,
  buildVideoEmbedUrl,
  parseVideoUrl,
  resolveVideoField,
  resolveVideoUrlToEmbed,
  videoProviderOf,
} from '../../../shared/utils/video-embed';

const ID = 'e5ei86oZFUw';

describe('buildVideoEmbedUrl', () => {
  it('builds the privacy-enhanced YouTube player', () => {
    expect(buildVideoEmbedUrl('youtube', ID)).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}`,
    );
  });

  it('builds the Vimeo player with do-not-track', () => {
    expect(buildVideoEmbedUrl('vimeo', '123456789')).toBe(
      'https://player.vimeo.com/video/123456789?dnt=1',
    );
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc123'],
    ['too long', `${ID}x`],
    ['a path', `../../${ID}`],
    ['a query', `${ID}?autoplay=1`],
    ['markup', '"><script>x</script>'],
    ['a javascript: url', 'javascript:alert(1)'],
    ['an encoded slash', 'abc%2F12345'],
  ])('refuses a YouTube id that is %s', (_label, id) => {
    expect(buildVideoEmbedUrl('youtube', id)).toBeNull();
  });

  it.each([['abc'], ['123/456'], ['123?x=1'], ['1234567890123']])(
    'refuses Vimeo id %s',
    (id) => {
      expect(buildVideoEmbedUrl('vimeo', id)).toBeNull();
    },
  );

  it('only ever produces srcs on the CSP allowlist', () => {
    for (const src of [
      buildVideoEmbedUrl('youtube', ID),
      buildVideoEmbedUrl('vimeo', '42'),
    ]) {
      expect(VIDEO_FRAME_ORIGINS).toContain(new URL(src!).origin);
    }
  });
});

describe('parseVideoUrl', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=30s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])('reads the YouTube id from %s', (url) => {
    expect(parseVideoUrl(url)).toEqual({ provider: 'youtube', id: ID });
  });

  it.each([
    'https://vimeo.com/123456',
    'https://player.vimeo.com/video/123456',
  ])('reads the Vimeo id from %s', (url) => {
    expect(parseVideoUrl(url)).toEqual({ provider: 'vimeo', id: '123456' });
  });

  it.each([
    // Look-alike and embedded hosts are not the provider.
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/?u=https://www.youtube.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    'https://vimeo.com.evil.example/123456',
    // Wrong scheme or not a URL.
    `javascript:alert('https://youtu.be/${ID}')`,
    `data:text/html,https://youtu.be/${ID}`,
    'not a url',
    // Provider host, but no valid id.
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UCabcdefghij',
    'https://player.vimeo.com/other/123456',
  ])('refuses %s', (url) => {
    expect(parseVideoUrl(url)).toBeNull();
    expect(resolveVideoUrlToEmbed(url)).toBeNull();
  });
});

describe('videoProviderOf', () => {
  it('recognises the allowlisted players only', () => {
    expect(
      videoProviderOf(`https://www.youtube-nocookie.com/embed/${ID}`),
    ).toBe('youtube');
    expect(videoProviderOf('https://player.vimeo.com/video/1?dnt=1')).toBe(
      'vimeo',
    );
    expect(videoProviderOf(`https://www.youtube.com/embed/${ID}`)).toBeNull();
    expect(videoProviderOf('https://evil.example/embed/x')).toBeNull();
    expect(videoProviderOf('javascript:alert(1)')).toBeNull();
  });
});

describe('resolveVideoField', () => {
  const PLAYER = `https://www.youtube-nocookie.com/embed/${ID}`;

  it.each([
    ['a bare id', ID],
    ['an id with spaces around it', `  ${ID} `],
    ['an id with a share suffix', `${ID}?si=AbCdEf123`],
    ['an id with a timestamp', `${ID}&t=42`],
    ['a watch URL', `https://www.youtube.com/watch?v=${ID}`],
    ['a short link', `https://youtu.be/${ID}?si=x`],
  ])('accepts %s', (_label, value) => {
    expect(resolveVideoField('youtube', value)).toBe(PLAYER);
  });

  it('takes the provider from a pasted URL over the field setting', () => {
    expect(resolveVideoField('youtube', 'https://vimeo.com/42')).toBe(
      'https://player.vimeo.com/video/42?dnt=1',
    );
  });

  it.each([
    `https://evil.example/embed/${ID}`,
    `../../watch?v=${ID}`,
    '"><script>alert(1)</script>',
    'abc123',
  ])('refuses %s', (value) => {
    expect(resolveVideoField('youtube', value)).toBeNull();
  });
});

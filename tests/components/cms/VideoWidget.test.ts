import { describe, it, expect } from 'vitest';
import { mountComponent } from '../../utils/component';
import VideoWidget from '../../../app/components/cms/widgets/VideoWidget.vue';

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      name: 'test-video',
      active: true,
      videoId: 'dQw4w9WgXcQ',
      videoProvider: 0,
      ...overrides,
    },
    config: {
      name: 'test',
      displayName: 'Test Video',
      active: true,
      type: 'VideoPageWidget',
      size: 'full',
      sortOrder: 0,
    },
    layout: 'full',
  };
}

/** The player loads on the visitor's click; press it and return the frame. */
async function play(props: ReturnType<typeof makeProps>) {
  const wrapper = mountComponent(VideoWidget, { props });
  const consent = wrapper.find('[data-testid="video-embed-consent"]');
  if (consent.exists()) await consent.trigger('click');
  return wrapper;
}

describe('VideoWidget', () => {
  it('frames nothing from the provider before the visitor presses play', () => {
    const wrapper = mountComponent(VideoWidget, { props: makeProps() });
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('[data-testid="video-embed-consent"]').exists()).toBe(
      true,
    );
  });

  it('renders the privacy-enhanced YouTube player', async () => {
    const wrapper = await play(makeProps());
    const iframe = wrapper.find('iframe');
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
    );
  });

  it('renders the Vimeo player with do-not-track', async () => {
    const wrapper = await play(
      makeProps({ videoId: '123456789', videoProvider: 1 }),
    );
    const src = new URL(wrapper.find('iframe').attributes('src')!);
    expect(src.origin + src.pathname).toBe(
      'https://player.vimeo.com/video/123456789',
    );
    expect(src.searchParams.get('dnt')).toBe('1');
  });

  it('does not render when videoId is empty', () => {
    const wrapper = mountComponent(VideoWidget, {
      props: makeProps({ videoId: '' }),
    });
    expect(wrapper.find('[data-testid="cms-widget"]').exists()).toBe(false);
  });

  it.each([
    ['a path', '../../watch?v=dQw4w9WgXcQ'],
    ['markup', '"><img src=x onerror=alert(1)>'],
    ['a full URL', 'https://evil.example/embed/dQw4w9WgXcQ'],
    ['a short id', 'abc123'],
  ])('renders nothing for a YouTube id that is %s', (_label, videoId) => {
    const wrapper = mountComponent(VideoWidget, {
      props: makeProps({ videoId }),
    });
    expect(wrapper.find('[data-testid="cms-widget"]').exists()).toBe(false);
    expect(wrapper.find('iframe').exists()).toBe(false);
  });

  it.each([
    ['an id with a share suffix', 'dQw4w9WgXcQ?si=AbCdEf123'],
    ['a pasted watch URL', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ])('plays a YouTube field holding %s', async (_label, videoId) => {
    const wrapper = await play(makeProps({ videoId }));
    expect(wrapper.find('iframe').attributes('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
    );
  });

  it('renders nothing for a non-numeric Vimeo id', () => {
    const wrapper = mountComponent(VideoWidget, {
      props: makeProps({ videoId: 'abc', videoProvider: 1 }),
    });
    expect(wrapper.find('[data-testid="cms-widget"]').exists()).toBe(false);
  });

  it('has data-testid="cms-widget"', () => {
    const wrapper = mountComponent(VideoWidget, { props: makeProps() });
    expect(wrapper.find('[data-testid="cms-widget"]').exists()).toBe(true);
  });

  it('defaults to YouTube when videoProvider is undefined', async () => {
    const wrapper = await play(makeProps({ videoProvider: undefined }));
    expect(wrapper.find('iframe').attributes('src')).toContain(
      'youtube-nocookie.com/embed/',
    );
  });
});

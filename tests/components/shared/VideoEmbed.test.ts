import { describe, it, expect } from 'vitest';
import { mountComponent } from '../../utils/component';
import VideoEmbed from '../../../app/components/shared/VideoEmbed.vue';

const SRC = 'https://www.youtube-nocookie.com/embed/e5ei86oZFUw';

describe('VideoEmbed', () => {
  it('loads nothing from the provider until the visitor presses play', () => {
    const wrapper = mountComponent(VideoEmbed, {
      props: { src: SRC, title: 'T-kontakt' },
    });
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    const button = wrapper.find('[data-testid="video-embed-consent"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('video.consent');
  });

  it('frames the allowlisted player after the click, with fullscreen allowed', async () => {
    const wrapper = mountComponent(VideoEmbed, {
      props: { src: SRC, title: 'T-kontakt' },
    });
    await wrapper.find('[data-testid="video-embed-consent"]').trigger('click');
    const iframe = wrapper.find('iframe');
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes('src')).toBe(`${SRC}?autoplay=1`);
    expect(iframe.attributes('allow')).toContain('fullscreen');
    expect(iframe.attributes('allowfullscreen')).toBeDefined();
    expect(iframe.attributes('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-presentation allow-popups',
    );
    expect(iframe.attributes('referrerpolicy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('keeps the Vimeo do-not-track flag when adding autoplay', async () => {
    const wrapper = mountComponent(VideoEmbed, {
      props: { src: 'https://player.vimeo.com/video/42?dnt=1', title: 'V' },
    });
    await wrapper.find('[data-testid="video-embed-consent"]').trigger('click');
    const src = new URL(wrapper.find('iframe').attributes('src')!);
    expect(src.searchParams.get('dnt')).toBe('1');
    expect(src.searchParams.get('autoplay')).toBe('1');
  });

  it.each([
    'https://www.youtube.com/embed/e5ei86oZFUw',
    'https://evil.example/embed/e5ei86oZFUw',
    'javascript:alert(1)',
    '',
  ])('renders nothing for a src off the allowlist: %s', (src) => {
    const wrapper = mountComponent(VideoEmbed, {
      props: { src, title: 'x' },
    });
    expect(wrapper.find('[data-testid="video-embed"]').exists()).toBe(false);
    expect(wrapper.find('iframe').exists()).toBe(false);
  });

  it('stays inside its container: full width, capped, clipped', () => {
    const wrapper = mountComponent(VideoEmbed, {
      props: { src: SRC, title: 'x' },
    });
    const classes = wrapper
      .find('[data-testid="video-embed"]')
      .classes()
      .join(' ');
    expect(classes).toContain('w-full');
    expect(classes).toContain('max-w-full');
    expect(classes).toContain('overflow-hidden');
    expect(classes).toContain('aspect-video');
  });
});

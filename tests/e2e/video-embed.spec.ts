import { test, expect, type Page } from '@playwright/test';
import { outOfScope, waitForHydration } from './helpers';

/**
 * Embedded video, tenant by tenant.
 *
 * Runs against whatever tenant the suite targets, so the same file checks
 * each storefront on its own: by default the team tenant's homepage (a CMS
 * Video widget), and with E2E_VIDEO_PATH a page of the operator's choosing,
 * e.g. a product with a VideoURL parameter:
 *
 *   E2E_VIDEO_PATH=/se/sv/p/<category>/<product> pnpm test:e2e video-embed
 *
 * A page with no video is declared out of scope rather than passed.
 */

const VIDEO_PATH = process.env.E2E_VIDEO_PATH || '/';

const PROVIDER_HOSTS =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|vimeo\.com|vimeocdn\.com)$/;

const ALLOWED_PLAYER_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
];

/** Requests the page made to a video provider, by hostname. */
function trackProviderRequests(page: Page): string[] {
  const hosts: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (PROVIDER_HOSTS.test(host)) hosts.push(host);
  });
  return hosts;
}

function trackCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      /Content Security Policy|frame-src/i.test(msg.text())
    ) {
      violations.push(msg.text());
    }
  });
  return violations;
}

async function overhang(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

/**
 * The outermost elements reaching past the right edge, so an overflow
 * failure names its cause instead of only its size. Elements an ancestor
 * clips (carousel slides waiting off-screen) cannot widen the page and are
 * left out.
 */
async function widestElements(page: Page): Promise<string> {
  return page.evaluate(() => {
    const limit = window.innerWidth + 1;
    const clipped = (el: Element) => {
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        const { overflowX } = getComputedStyle(p);
        if (overflowX !== 'visible') return true;
      }
      return false;
    };
    const describe = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const cls = (el.getAttribute('class') ?? '')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join('.');
      const style = el.getAttribute('style');
      const owner = el.closest('[data-testid]')?.getAttribute('data-testid');
      return [
        `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`,
        `left=${Math.round(rect.left)} right=${Math.round(rect.right)}`,
        style ? `style="${style.slice(0, 80)}"` : '',
        owner ? `in [data-testid=${owner}]` : '',
      ]
        .filter(Boolean)
        .join(' ');
    };
    const wide = [...document.body.querySelectorAll('*')].filter(
      (el) => el.getBoundingClientRect().right > limit && !clipped(el),
    );
    const outermost = wide.filter(
      (el) => !wide.some((other) => other !== el && other.contains(el)),
    );
    return outermost.slice(0, 5).map(describe).join(' | ') || 'none found';
  });
}

test.describe('Embedded video', () => {
  for (const viewport of [
    { label: 'mobile', width: 375, height: 812 },
    { label: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`loads only on request, from an allowlisted player, without overflow (${viewport.label})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const providerRequests = trackProviderRequests(page);
      const cspViolations = trackCspViolations(page);

      const skippedWidgets: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('[cms] video widget')) {
          skippedWidgets.push(msg.text().replace(/^.*\[cms\]/, '[cms]'));
        }
      });

      await page.goto(VIDEO_PATH);
      await waitForHydration(page);

      const embed = page.locator('[data-testid="video-embed"]').first();
      const count = await page.locator('[data-testid="video-embed"]').count();
      outOfScope(
        count === 0,
        'fixture-missing',
        `no embedded video on ${VIDEO_PATH} for this tenant${
          skippedWidgets.length ? ` (${skippedWidgets.join('; ')})` : ''
        }`,
      );

      // Before consent: no frame, and not one request to the provider.
      await expect(embed.locator('iframe')).toHaveCount(0);
      expect(
        providerRequests,
        'the page contacted a video provider before the visitor pressed play',
      ).toEqual([]);
      expect(
        await overhang(page),
        `${viewport.width}px: the page scrolls sideways; widest: ${await widestElements(page)}`,
      ).toBeLessThanOrEqual(1);

      await embed.scrollIntoViewIfNeeded();
      await embed.locator('[data-testid="video-embed-consent"]').click();

      const frame = embed.locator('iframe');
      await expect(frame).toHaveCount(1);
      const src = await frame.getAttribute('src');
      expect(ALLOWED_PLAYER_ORIGINS).toContain(new URL(src!).origin);
      expect(await frame.getAttribute('allow')).toContain('fullscreen');

      const box = await embed.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(viewport.width);
      expect(
        await overhang(page),
        `${viewport.width}px: the page scrolls sideways once the player loads; widest: ${await widestElements(page)}`,
      ).toBeLessThanOrEqual(1);

      expect(cspViolations, 'the player was blocked by the CSP').toEqual([]);
    });
  }
});

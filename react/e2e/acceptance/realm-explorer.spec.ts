import type { Page } from '@playwright/test';
import { expect, parentWithChild, signInAs, test, type Parent } from './support/fixtures';
// Brings the `window.__laiE2E` declaration (installed under `vite --mode e2e`).
import './support/cove';

/**
 * AP-03 Realm Explorer acceptance in a real browser against the local seeded Django (the real
 * content export plus Treasure Cove). Everything comes from Django except one test, which
 * stubs only the delivery URL of a picture to check how a published image is drawn; the
 * Django side of pictures is covered by `test_realm_explorer.py`.
 *
 * Screenshots for visual review land in test-results/acceptance/realms/.
 */

const SHOTS = 'test-results/acceptance/realms';

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-360', width: 360, height: 780 },
  { name: 'mobile-320', width: 320, height: 640 },
] as const;

async function openRealms(page: Page, childId: string, query = '') {
  const catalog = page.waitForResponse(
    (r) => r.url().includes(`/children/${childId}/islands/`) && r.request().method() === 'GET',
  );
  await page.goto(`/island/${childId}/realms${query}`);
  expect((await catalog).status()).toBe(200);
  await expect(page.getByRole('article', { name: 'Learning Adventure Island' })).toBeVisible();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe.serial('Realm Explorer (AP-03)', () => {
  let parent: Parent;
  let childId: string;

  test.beforeAll(async ({ request }) => {
    ({ parent, childId } = await parentWithChild(request, 'ap03-realms', {
      nickname: 'Robin',
      ageBand: 'PATHFINDER',
    }));
  });

  for (const viewport of VIEWPORTS) {
    test(`lays out at ${viewport.width}px without overflow or overlap`, async ({
      page,
      problems,
    }) => {
      void problems;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signInAs(page, parent);
      await openRealms(page, childId);

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // Three tracks from 1280px, two from 768px, one below (admin.css must not override).
      const tracks = await page
        .locator('[data-realm]')
        .first()
        .evaluate(
          (el) => getComputedStyle(el.closest('ul')!).gridTemplateColumns.split(' ').length,
        );
      expect(tracks).toBe(viewport.width >= 1280 ? 3 : viewport.width >= 768 ? 2 : 1);
      // The branding is visible at every size: in the sidebar from 768px, else the top bar.
      const brandHolder =
        viewport.width >= 768
          ? page.getByRole('navigation', { name: 'Island' })
          : page.getByRole('banner');
      await expect(brandHolder.getByText(/Learning Adventure Island/)).toBeVisible();
      const home = page.getByRole('article', { name: 'Learning Adventure Island' });
      const cove = page.getByRole('article', { name: 'Creature Care Cove' });
      const [a, b] = [await home.boundingBox(), await cove.boundingBox()];
      expect(a && b).toBeTruthy();
      if (a && b) {
        // Two columns from tablet up (three from 1280px), one on phones.
        if (viewport.width >= 768) expect(Math.abs(a.y - b.y)).toBeLessThan(2);
        else expect(b.y).toBeGreaterThan(a.y + a.height - 1);
      }

      // The header and navigation never cover the page, at the top or the bottom.
      const nav = await page.getByRole('navigation', { name: 'Island' }).boundingBox();
      const banner = await page.getByRole('banner').boundingBox();
      const hero = await page
        .getByRole('heading', { level: 1, name: 'Realm Explorer' })
        .boundingBox();
      expect(nav && banner && hero).toBeTruthy();
      if (nav && banner && hero) {
        expect(hero.y).toBeGreaterThanOrEqual(banner.y + banner.height);
        if (viewport.width < 768) {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const explore = await page
            .getByRole('link', { name: 'Explore Learning Adventure Island' })
            .boundingBox();
          const lastCard = await cove.boundingBox();
          const navNow = await page.getByRole('navigation', { name: 'Island' }).boundingBox();
          expect(explore && lastCard && navNow).toBeTruthy();
          if (lastCard && navNow) {
            expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(navNow.y + 1);
          }
        } else {
          expect(hero.x).toBeGreaterThanOrEqual(nav.x + nav.width);
        }
      }

      // Touch targets: every filter chip and card action is at least 48px tall.
      for (const target of await page
        .locator('[data-portal="realm-filters"] button, [data-realm] a')
        .all()) {
        const box = await target.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/explorer-${viewport.name}.png`, fullPage: true });
    });
  }

  test('filters with real catalog data, without reloading', async ({ page, problems }) => {
    void problems;
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, parent);
    await openRealms(page, childId);
    const subjects = page.getByRole('group', { name: 'Subject' });
    // Only subjects some published Realm teaches are offered.
    await expect(subjects.getByRole('button')).toHaveText([
      /All Realms/,
      /Math/,
      /Reading/,
      /Science/,
      /Creativity/,
    ]);
    // A full reload would drop this marker; filtering must keep it.
    await page.evaluate(() => {
      (window as unknown as { realmMarker?: number }).realmMarker = 1;
    });

    await subjects.getByRole('button', { name: 'Creativity' }).click();
    await expect(page).toHaveURL(/\?subject=CREATIVITY$/);
    await expect(page.getByRole('article', { name: 'Creature Care Cove' })).toHaveCount(0);
    await expect(page.getByText('Showing 1 of 2 Realms')).toBeVisible();

    await subjects.getByRole('button', { name: 'Science' }).click();
    await expect(page.getByRole('article', { name: 'Creature Care Cove' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/explorer-filter-science.png`, fullPage: true });

    await subjects.getByRole('button', { name: 'All Realms' }).click();
    await expect(page.getByText('Showing all 2 Realms')).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { realmMarker?: number }).realmMarker),
    ).toBe(1);
  });

  test('a locked Realm shows its lock and hint, and has no way in', async ({ page, problems }) => {
    void problems;
    await signInAs(page, parent);
    await openRealms(page, childId);
    const cove = page.getByRole('article', { name: 'Creature Care Cove' });
    await expect(cove.getByText('Locked')).toBeVisible();
    await expect(cove.getByText(/Help Pip at Pirate Builder Bay/)).toBeVisible();
    await expect(cove.getByRole('link')).toHaveCount(0);
    await expect(cove.getByRole('button')).toHaveCount(0);
  });

  test('is usable by keyboard alone, with a visible focus ring', async ({ page, problems }) => {
    void problems;
    await signInAs(page, parent);
    await openRealms(page, childId);
    const math = page.getByRole('group', { name: 'Subject' }).getByRole('button', { name: 'Math' });
    for (let i = 0; i < 40 && !(await math.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(math).toBeFocused();
    const outline = await math.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(math).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `${SHOTS}/explorer-keyboard-focus.png` });
  });

  test('respects reduced motion', async ({ page, problems }) => {
    void problems;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAs(page, parent);
    await openRealms(page, childId);
    const duration = await page
      .getByRole('article', { name: 'Learning Adventure Island' })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // global.css's reduced-motion rule (0.01ms) wins over the card's own transition.
    expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  });

  test('previews a Realm, keeps the filter on the way back', async ({ page, problems }) => {
    void problems;
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, parent);
    await openRealms(page, childId, '?subject=MATH');
    await page.getByRole('link', { name: 'Explore Learning Adventure Island' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/island/${childId}/realms/learning-adventure-island$`),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Learning Adventure Island' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Island' }).getByRole('link', { name: 'Realms' }),
    ).toHaveAttribute('aria-current', 'page');
    const places = page.getByRole('region', { name: 'Places in Learning Adventure Island' });
    const bay = places.getByRole('article', { name: 'Pirate Builder Bay' });
    await expect(bay.getByRole('link', { name: 'Explore Treasure Cove in 3D' })).toBeVisible();
    await expect(places.getByRole('article', { name: 'Storykeeper Castle' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start Exploring' })).toBeVisible();
    // No Three.js scene is created just to show cards.
    expect(await page.locator('canvas').count()).toBe(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/detail-desktop-1280.png`, fullPage: true });

    await page.setViewportSize({ width: 360, height: 780 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/detail-mobile-360.png`, fullPage: true });

    await page.getByRole('link', { name: 'Back to Realms' }).click();
    await expect(page).toHaveURL(new RegExp(`/island/${childId}/realms\\?subject=MATH$`));
    await expect(
      page.getByRole('group', { name: 'Subject' }).getByRole('button', { name: 'Math' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('launches Treasure Cove in 3D, and leaves back to the Realms without a question', async ({
    page,
    problems,
  }) => {
    void problems;
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, parent);
    await page.goto(`/island/${childId}/realms/learning-adventure-island`);
    const bootstrap = page.waitForResponse(
      (r) => /\/regions\/treasure-rush-cove\/$/.test(r.url()) && r.request().method() === 'GET',
    );
    await page.getByRole('link', { name: 'Explore Treasure Cove in 3D' }).click();
    expect((await bootstrap).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__laiE2E?.entities().length ?? 0))
      .toBeGreaterThan(5);

    await page.getByRole('button', { name: 'Leave island' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/island/${childId}/realms$`));
    await expect(
      page.getByText('Your adventure is saved. Where would you like to go next?'),
    ).toBeVisible();
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Leave island' })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/after-leave.png` });
  });

  test('progress from Django updates after visiting', async ({ page, problems }) => {
    void problems;
    await signInAs(page, parent);
    await openRealms(page, childId);
    // The previous test entered Treasure Cove, so Pirate Builder Bay now counts as explored.
    const progress = page
      .getByRole('article', { name: 'Learning Adventure Island' })
      .getByRole('progressbar', { name: 'Explored' });
    await expect(progress).toHaveAttribute('aria-valuetext', /^[1-9]\d* of \d+ places explored$/);
  });

  test('draws a published picture, and the drawing when it fails', async ({ page, problems }) => {
    // The deliberately missing picture logs the browser's own 404 line.
    problems.allowConsole(/Failed to load resource/);
    await page.setViewportSize({ width: 1280, height: 900 });
    // Only the delivery is stubbed: the catalog names a picture and the resolver serves it.
    await page.route(`**/api/v1/children/${childId}/islands/`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        islands: { islandId: string; thumbnailAssetId: string | null }[];
      };
      for (const island of body.islands) {
        if (island.islandId === 'learning-adventure-island')
          island.thumbnailAssetId = 'e2e-home-art';
        if (island.islandId === 'creature-care-cove') island.thumbnailAssetId = 'e2e-broken-art';
      }
      await route.fulfill({ response, json: body });
    });
    const expires = new Date(Date.now() + 3_600_000).toISOString();
    await page.route(`**/api/v1/children/${childId}/assets/**`, (route) =>
      route.fulfill({
        json: {
          assets: ['e2e-home-art', 'e2e-broken-art'].map((ref) => ({
            ref,
            id: ref,
            status: 'resolved',
            kind: 'image',
            family: 'image',
            format: 'png',
            url: `/e2e-art/${ref}.png`,
            urlExpiresAt: expires,
          })),
        },
      }),
    );
    // A 1x1 ocean-blue PNG for the first, a 404 for the second.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk2PnqPwAFWQKlS+Q+3QAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.route('**/e2e-art/e2e-home-art.png', (route) =>
      route.fulfill({ body: png, contentType: 'image/png' }),
    );
    await page.route('**/e2e-art/e2e-broken-art.png', (route) => route.fulfill({ status: 404 }));

    await signInAs(page, parent);
    await page.goto(`/island/${childId}/realms`);
    const homeImage = page
      .getByRole('article', { name: 'Learning Adventure Island' })
      .locator('img[alt="Learning Adventure Island"]');
    await expect(homeImage).toHaveAttribute('loading', 'eager');
    await expect
      .poll(() => homeImage.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(1);
    const cove = page.getByRole('article', { name: 'Creature Care Cove' });
    await expect(cove.locator('img')).toHaveCount(0);
    await expect(cove.getByRole('img', { name: 'Creature Care Cove' })).toBeVisible();
  });
});

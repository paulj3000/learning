import type { Page } from '@playwright/test';
import { expect, parentWithChild, signInAs, test, type Parent } from './support/fixtures';
import './support/cove';

/**
 * P0: Cognito without Amplify, and Realm Explorer navigation, in a real browser against the
 * local seeded Django. The app gets its Cognito pool and client from VITE_COGNITO_* only
 * (start-vite.mjs writes no amplify_outputs.json), exactly like a fresh checkout.
 *
 * Owner-reported defects this guards against:
 * 1. the homepage told parents to run an Amplify sandbox;
 * 2. Realms sent the child back to Home;
 * 3. a direct Realm Explorer URL could wait forever.
 *
 * Every journey runs at phone, tablet and desktop widths. Screenshots: test-results/acceptance/p0/.
 */

const SHOTS = 'test-results/acceptance/p0';

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 780 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const AMPLIFY_SETUP_TEXT = /amplify|sandbox|npm run|amplify_outputs/i;

async function noHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

/** The child navigation: a sidebar from tablet up, a bottom bar on phones. */
function childNav(page: Page) {
  return page.getByRole('navigation', { name: 'Island' });
}

test.describe('P0: public homepage with Cognito and no Amplify backend', () => {
  for (const viewport of VIEWPORTS) {
    test(`offers working sign-up and sign-in at ${viewport.name} width`, async ({
      page,
      problems,
    }) => {
      void problems;
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(
        page.getByRole('heading', { level: 1, name: /an island that grows/i }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create a parent account' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(AMPLIFY_SETUP_TEXT);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/home-${viewport.name}.png`, fullPage: true });

      await page.getByRole('link', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { level: 1, name: /^sign in$/i })).toBeVisible();
      await expect(page.getByLabel(/email address/i)).toBeVisible();
      await page.goto('/sign-up');
      await expect(
        page.getByRole('heading', { level: 1, name: /create a parent account/i }),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(AMPLIFY_SETUP_TEXT);
    });
  }
});

test.describe.serial('P0: Home -> Realms -> Treasure Cove and Storykeeper Castle', () => {
  let parent: Parent;
  let childId: string;

  test.beforeAll(async ({ request }) => {
    ({ parent, childId } = await parentWithChild(request, 'p0-realms', {
      nickname: 'Robin',
      ageBand: 'PATHFINDER',
    }));
  });

  for (const viewport of VIEWPORTS) {
    test(`profile select, Realms, Places and back again at ${viewport.name} width`, async ({
      page,
      problems,
    }) => {
      void problems;
      await page.setViewportSize(viewport);
      await signInAs(page, parent);

      await test.step('the parent selects the child profile', async () => {
        await page.goto('/home');
        await expect(
          page.getByRole('heading', { level: 1, name: "Robin's dashboard" }),
        ).toBeVisible();
        await page.getByRole('link', { name: 'Enter island' }).click();
        await expect(page).toHaveURL(new RegExp(`/island/${childId}$`));
      });

      await test.step('Realms opens the Realm Explorer, not Home', async () => {
        await childNav(page).getByRole('link', { name: 'Realms' }).click();
        await expect(page).toHaveURL(new RegExp(`/island/${childId}/realms$`));
        await expect(page.getByRole('heading', { level: 1, name: 'Realm Explorer' })).toBeVisible();
        await expect(
          page.getByRole('article', { name: 'Learning Adventure Island' }),
        ).toBeVisible();
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/realms-${viewport.name}.png`, fullPage: true });
      });

      await test.step('Treasure Cove and Storykeeper Castle are discoverable', async () => {
        await page.getByRole('link', { name: 'Explore Learning Adventure Island' }).click();
        await expect(page).toHaveURL(
          new RegExp(`/island/${childId}/realms/learning-adventure-island$`),
        );
        const places = page.getByRole('region', {
          name: 'Places in Learning Adventure Island',
        });
        await expect(
          places
            .getByRole('article', { name: 'Pirate Builder Bay' })
            .getByRole('link', { name: /Treasure Cove/ }),
        ).toBeVisible();
        const castle = places.getByRole('article', { name: 'Storykeeper Castle' });
        await expect(castle.getByRole('link', { name: 'Visit Storykeeper Castle' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Start Exploring' })).toBeVisible();
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `${SHOTS}/detail-${viewport.name}.png`, fullPage: true });
      });

      await test.step('Start Exploring opens a Place', async () => {
        const start = page.getByRole('link', { name: 'Start Exploring' });
        const href = await start.getAttribute('href');
        expect(href).toMatch(new RegExp(`^/island/${childId}/(locations|explore)/`));
        await start.click();
        await expect(page).toHaveURL(new RegExp(`${href}$`));
        if (href?.includes('/locations/')) {
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        } else {
          await expect
            .poll(() => page.evaluate(() => window.__laiE2E?.entities().length ?? 0))
            .toBeGreaterThan(5);
        }
        await expect(page.getByRole('alert')).toHaveCount(0);
      });

      await test.step('Storykeeper Castle is launchable', async () => {
        await page.goto(`/island/${childId}/realms/learning-adventure-island`);
        await page.getByRole('link', { name: 'Visit Storykeeper Castle' }).click();
        await expect(page).toHaveURL(
          new RegExp(`/island/${childId}/locations/storykeeper-castle$`),
        );
        await expect(
          page.getByRole('heading', { level: 1, name: 'Storykeeper Castle' }),
        ).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.screenshot({ path: `${SHOTS}/castle-${viewport.name}.png`, fullPage: true });
      });

      await test.step('Home, then Realms again, still works', async () => {
        await page.goto(`/island/${childId}/realms`);
        await childNav(page).getByRole('link', { name: 'Home' }).click();
        await expect(page).toHaveURL(new RegExp(`/island/${childId}$`));
        await childNav(page).getByRole('link', { name: 'Realms' }).click();
        await expect(page).toHaveURL(new RegExp(`/island/${childId}/realms$`));
        await expect(
          page.getByRole('article', { name: 'Learning Adventure Island' }),
        ).toBeVisible();
      });
    });
  }

  test('Treasure Cove launches in 3D from the Realm page', async ({ page, problems }) => {
    void problems;
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, parent);
    await page.goto(`/island/${childId}/realms/learning-adventure-island`);
    const bootstrap = page.waitForResponse(
      (r) => /\/regions\/treasure-rush-cove\/$/.test(r.url()) && r.request().method() === 'GET',
    );
    await page
      .getByRole('article', { name: 'Pirate Builder Bay' })
      .getByRole('link', { name: /Treasure Cove/ })
      .click();
    expect((await bootstrap).status()).toBe(200);
    await expect
      .poll(() => page.evaluate(() => window.__laiE2E?.entities().length ?? 0))
      .toBeGreaterThan(5);
  });

  test('Storykeeper Castle opens its walk-around world from its Place page', async ({
    page,
    problems,
  }) => {
    void problems;
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, parent);
    await page.goto(`/island/${childId}/locations/storykeeper-castle`);
    await page.getByRole('link', { name: 'Try exploring the castle (new!)' }).click();
    await expect(page).toHaveURL(new RegExp(`/island/${childId}/world/storykeeper-castle$`));
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('direct Realm Explorer and Realm URLs load on a fresh page', async ({ page, problems }) => {
    void problems;
    await signInAs(page, parent);
    await page.goto(`/island/${childId}/realms`);
    await expect(page.getByRole('article', { name: 'Learning Adventure Island' })).toBeVisible();
    await page.goto(`/island/${childId}/realms/learning-adventure-island`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Learning Adventure Island' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Learning Adventure Island' }),
    ).toBeVisible();
  });

  test('a Django that does not answer ends in a friendly error, not a wait', async ({
    page,
    problems,
  }) => {
    // The dev proxy answers 504 when Django does not answer within its bound (devProxy.ts).
    problems.allowConsole(/Failed to load resource/);
    problems.allowStatus(/\/islands\/$/, 504);
    await signInAs(page, parent);
    await page.route(`**/api/v1/children/${childId}/islands/`, (route) =>
      route.fulfill({ status: 504, body: 'Gateway Timeout' }),
    );
    await page.goto(`/island/${childId}/realms`);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('We could not load the Realms right now.');
    await expect(page.getByText('Finding your Realms...')).toHaveCount(0);
    expect(await alert.innerText()).not.toMatch(/amplify|sandbox/i);
    await page.unroute(`**/api/v1/children/${childId}/islands/`);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('article', { name: 'Learning Adventure Island' })).toBeVisible();
  });
});

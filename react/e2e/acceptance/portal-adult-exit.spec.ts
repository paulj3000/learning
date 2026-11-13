import type { Locator, Page } from '@playwright/test';
import { expect, parentWithChild, signInAs, test, type Parent } from './support/fixtures';
import { approach, enterCove } from './support/cove';

/**
 * The exits stay reachable while a game panel is open (Trello fOwy8OIb, AP-01 follow-up).
 *
 * On 320 and 375px phones Pirate Pip's panel (70vh cap) used to reach up over the top bar and
 * cover "Leave island" and "Adults: exit to parent space". The shell now publishes how far down
 * the top bar reaches (`--child-header-inset`) and every fixed game layer stays below it, with
 * its own content scrolling. Checked at phone, tablet and desktop widths, by keyboard, and in
 * full screen (where the stage's own exits take over). Runs with the legacy Pip on a fresh stack
 * and with the managed Pip after npc-1-admin publishes the NPC release.
 *
 * Screenshots: test-results/acceptance/portal-adult-exit/.
 */

const SHOTS = 'test-results/acceptance/portal-adult-exit';
const ADULT_EXIT = 'Adults: exit to parent space';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** True when a click at the element's centre lands on the element itself (nothing covers it). */
async function hittable(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.width > 0 && r.height > 0 && !!hit && (hit === el || el.contains(hit));
  });
}

/**
 * Arrives in the parent space. A Treasure Rush encounter (the legacy Pip's panel) asks once
 * first (AP-04, "Leave the island now?"); a managed NPC conversation is not an encounter and
 * leaves straight away. Either way the exit must work while the panel is open.
 */
async function confirmLeave(page: Page) {
  const confirm = page.getByRole('dialog', { name: 'Leave the island now?' });
  await expect
    .poll(async () => (await confirm.isVisible()) || /\/home/.test(page.url()))
    .toBe(true);
  if (await confirm.isVisible()) {
    await confirm.getByRole('button', { name: 'Leave island' }).click();
  }
  await expect(page).toHaveURL(/\/home/);
}

async function openPip(page: Page): Promise<Locator> {
  await approach(page, 'cove-pip');
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Pirate Pip' });
  await expect(dialog.getByRole('button', { name: 'Maybe later' })).toBeAttached();
  return dialog;
}

test.describe.serial('Exits stay reachable while a game panel is open', () => {
  let parent: Parent;
  let childId: string;

  test.beforeAll(async ({ request }) => {
    ({ parent, childId } = await parentWithChild(request, 'adult-exit', {
      nickname: 'Robin',
      ageBand: 'PATHFINDER',
    }));
  });

  for (const viewport of VIEWPORTS) {
    test(`Pip's panel leaves the exits uncovered at ${viewport.width}x${viewport.height}`, async ({
      page,
      problems,
    }) => {
      void problems;
      await page.setViewportSize(viewport);
      await signInAs(page, parent);
      await enterCove(page, childId);
      const dialog = await openPip(page);
      const adult = page.getByRole('button', { name: ADULT_EXIT });
      const leave = page.getByRole('button', { name: 'Leave island' }).first();

      // The exits: visible and not covered by the open panel.
      expect(await hittable(adult), 'adult exit uncovered').toBe(true);
      expect(await hittable(leave), 'Leave island uncovered').toBe(true);
      const banner = await page.getByRole('banner').boundingBox();
      const panel = await dialog.boundingBox();
      expect(banner && panel).toBeTruthy();
      expect(panel!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height - 1);

      // The panel's own content is reachable: every choice scrolls into view and is tappable,
      // and none sits under the child nav.
      const nav = await page.getByRole('navigation', { name: 'Island' }).boundingBox();
      for (const name of ['Yes, I will help!', 'Maybe later']) {
        const choice = dialog.getByRole('button', { name });
        await choice.scrollIntoViewIfNeeded();
        expect(await hittable(choice), `${name} tappable`).toBe(true);
        const box = await choice.boundingBox();
        if (viewport.width < 768) expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y + 1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/pip-open-${viewport.width}.png` });

      // The adult exit works while the panel is still open (one confirmation, AP-04).
      await adult.click();
      await confirmLeave(page);
    });
  }

  test('keyboard: the adult exit is reachable with the panel open', async ({ page, problems }) => {
    void problems;
    await page.setViewportSize({ width: 375, height: 667 });
    await signInAs(page, parent);
    await enterCove(page, childId);
    const dialog = await openPip(page);
    const adult = page.getByRole('button', { name: ADULT_EXIT });
    // The legacy Treasure Rush panel is not modal: Tab leaves it. The NPC Manager's panel is a
    // modal dialog that keeps Tab inside (QA'd in npc-4-a11y); Escape closes it and returns
    // focus to the page, from where the exit is a few Tabs away.
    if ((await dialog.getAttribute('aria-modal')) === 'true') {
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Shift+Tab');
      reached = await adult.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'adult exit reachable by keyboard').toBe(true);
    expect(await adult.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await confirmLeave(page);
  });

  test("full screen: the stage's exits stay uncovered with Pip's panel open", async ({
    page,
    problems,
  }) => {
    void problems;
    await page.setViewportSize({ width: 375, height: 667 });
    await signInAs(page, parent);
    await enterCove(page, childId);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    const dialog = await openPip(page);
    await page.screenshot({ path: `${SHOTS}/pip-open-fullscreen-375.png` });
    // The stage's own exits (bottom left) and the harbor link (top) are uncovered.
    expect(await hittable(page.getByRole('button', { name: 'Exit full screen' }))).toBe(true);
    expect(await hittable(page.getByRole('link', { name: 'Go back to the harbor' }).first())).toBe(
      true,
    );
    const choice = dialog.getByRole('button', { name: 'Maybe later' });
    await choice.scrollIntoViewIfNeeded();
    expect(await hittable(choice)).toBe(true);
    await page.getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    expect(await hittable(page.getByRole('button', { name: ADULT_EXIT }))).toBe(true);
  });
});

import type { Page } from '@playwright/test';
import { api, expect, parentWithChild, signInAs, test, type Parent } from './support/fixtures';
import {
  answerInPanel,
  answerResponse,
  approach,
  challengeResponse,
  covePath,
  enterCove,
  issuedFrom,
  pictureAnswer,
  walk,
  wrongAnswer,
} from './support/cove';

/**
 * Treasure Rush acceptance (TR-12 to TR-20) in a real browser against a local Django: the
 * whole of Pip's Missing Treasure for one child, then controls, full screen, persistence and
 * the refusals. Each answer is the number the coin picture shows (`pictureAnswer`), worked
 * out from the issued challenge exactly as a child would; Django grades it.
 */

/** Closes the open panel; the HUD's Hint button comes back only once no panel is open. */
async function closePanel(page: Page) {
  await page.getByRole('button', { name: /^(Close|Keep exploring|Got it)$/ }).click();
  await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
}

/** Opens a chest from the action prompt and answers it right; returns the server outcome. */
async function openChest(page: Page, entityId: string, wrongFirst = false) {
  let issuedPromise = challengeResponse(page);
  await (await approach(page, entityId)).click();
  let issued = await issuedFrom(await issuedPromise);
  if (wrongFirst) {
    const graded = answerResponse(page);
    await answerInPanel(page, issued, wrongAnswer(issued));
    expect((await (await graded).json()).correct).toBe(false);
    await expect(page.getByText('Not quite. The lock is still shut.')).toBeVisible();
    issuedPromise = challengeResponse(page);
    await page.getByRole('button', { name: 'Try again' }).first().click();
    issued = await issuedFrom(await issuedPromise);
  }
  const graded = answerResponse(page);
  await answerInPanel(page, issued, pictureAnswer(issued));
  const outcome = (await (await graded).json()) as { correct: boolean };
  expect(outcome.correct).toBe(true);
  await expect(page.getByRole('heading', { name: 'Click! The chest is open!' })).toBeVisible();
  await expect(page.getByText('You found', { exact: true })).toBeVisible();
  await closePanel(page);
  return issued;
}

test.describe.serial("Pip's Missing Treasure, start to finish", () => {
  let parent: Parent;
  let childId: string;

  test.beforeAll(async ({ request }) => {
    ({ parent, childId } = await parentWithChild(request, 'tr-quest', {
      nickname: 'Robin',
      ageBand: 'PATHFINDER',
    }));
  });

  test('parent dashboard launches the child into Treasure Cove', async ({ page, problems }) => {
    void problems;
    await signInAs(page, parent);
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1, name: "Robin's dashboard" })).toBeVisible();
    await page.getByRole('link', { name: 'Enter island' }).click();
    await expect(page).toHaveURL(new RegExp(`/island/${childId}`));
    await enterCove(page, childId);
    await expect(page.getByText('Talk to Pirate Pip to start an adventure')).toBeVisible();
  });

  test('the quest: four encounters, the finale, the bridge and the spyglass', async ({
    page,
    problems,
  }) => {
    void problems;
    // The whole quest, played in order: about two minutes under software WebGL.
    test.setTimeout(300_000);
    await signInAs(page, parent);
    await enterCove(page, childId);

    await test.step('the grove chest is hidden until the first chest is open', async () => {
      await page.evaluate(() => window.__laiE2E!.standFacing('cove-grove-chest'));
      await expect(page.getByRole('button', { name: /^Open: / })).toHaveCount(0);
      expect(await page.evaluate(() => window.__laiE2E!.focused())).toBeNull();
    });

    await test.step('a chest out of order is refused kindly', async () => {
      await (await approach(page, 'cove-beach-chest')).click();
      await expect(page.getByText(/Not yet!|not ready yet/)).toBeVisible();
      await closePanel(page);
    });

    await test.step('a rune stone before the pedestal is refused kindly', async () => {
      await approach(page, 'cove-rune-stone-1');
      await page.keyboard.press('e');
      await expect(
        page.getByText('Read the glowing pedestal first. Then touch a stone.'),
      ).toBeVisible();
    });

    await test.step('Pip offers the quest and the child chooses to accept it (E key)', async () => {
      await approach(page, 'cove-pip');
      await page.keyboard.press('e');
      const dialog = page.getByRole('dialog', { name: 'Pirate Pip' });
      await expect(dialog.getByText('Will you help me?')).toBeVisible();
      await dialog.getByRole('button', { name: 'Yes, I will help!' }).click();
      // The managed Pip (NPC Manager) accepts through the same quest flow and thanks the child
      // with his authored line, instead of the legacy "Quest accepted!" panel (F-C).
      await expect(page.getByText("Find Pip's treasures: 0 of 4")).toBeVisible();
      await expect(dialog).toContainText('Thank you, friend!');
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('Hint names the next step only when asked', async () => {
      const hint = page.getByRole('button', { name: 'Hint' });
      await expect(hint).toHaveAttribute('aria-expanded', 'false');
      await hint.click();
      await expect(
        page.getByRole('status').filter({ hasText: /chest|Pirate Landing/i }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Got it' }).click();
      await expect(hint).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('Pirate Landing: a wrong answer opens nothing, then the right one does', async () => {
      await openChest(page, 'cove-chest', true);
      await expect(page.getByText("Find Pip's treasures: 1 of 4")).toBeVisible();
    });

    await test.step('Palm Tree Grove: the hidden chest is now open to a challenge', async () => {
      await openChest(page, 'cove-grove-chest');
      await expect(page.getByText("Find Pip's treasures: 2 of 4")).toBeVisible();
    });

    await test.step('Shipwreck Beach: locked without the key, open with it', async () => {
      await (await approach(page, 'cove-beach-chest')).click();
      await expect(
        page.getByText('This chest is locked. You need a key to open it!'),
      ).toBeVisible();
      await closePanel(page);
      await (await approach(page, 'cove-brass-key')).click();
      await expect(page.getByRole('heading', { name: 'You found something!' })).toBeVisible();
      await closePanel(page);
      await openChest(page, 'cove-beach-chest');
      await expect(page.getByText("Find Pip's treasures: 3 of 4")).toBeVisible();
    });

    await test.step('Ancient Treasure Ruins: the stones answer the pedestal', async () => {
      let issuedPromise = challengeResponse(page);
      await (await approach(page, 'cove-ruins-pedestal')).click();
      let issued = await issuedFrom(await issuedPromise);
      await closePanel(page);
      // A wrong stone says so and brings new numbers.
      const wrongIndex = issued.challenge.choices.findIndex((c) => c !== pictureAnswer(issued));
      issuedPromise = challengeResponse(page);
      let graded = answerResponse(page);
      await approach(page, `cove-rune-stone-${wrongIndex + 1}`);
      await page.keyboard.press('e');
      expect((await (await graded).json()).correct).toBe(false);
      await expect(page.getByText('Not that stone. The numbers changed. Try again!')).toBeVisible();
      issued = await issuedFrom(await issuedPromise);
      const rightIndex = issued.challenge.choices.indexOf(pictureAnswer(issued));
      expect(rightIndex).toBeGreaterThanOrEqual(0);
      graded = answerResponse(page);
      await approach(page, `cove-rune-stone-${rightIndex + 1}`);
      await page.keyboard.press('e');
      expect((await (await graded).json()).correct).toBe(true);
      await expect(
        page.getByText('The pedestal glows! The golden chest is unlocked.'),
      ).toBeVisible();
      await openChest(page, 'cove-final-chest');
      // All four found: the HUD sends the child back to Pip (TR-14).
      await expect(page.getByText('Bring the treasure back to Pip')).toBeVisible();
    });

    await test.step('the gate holds before the finale', async () => {
      await page.evaluate(() => window.__laiE2E!.standAt(0, -33.5, Math.PI));
      const stopped = await walk(page, 'w');
      expect(stopped.z).toBeGreaterThan(-35.5);
    });

    await test.step('the finale: Pip ends the quest, the bridge opens', async () => {
      await approach(page, 'cove-pip');
      await page.keyboard.press('e');
      await expect(page.getByRole('heading', { name: 'You found all my treasure!' })).toBeVisible();
      await closePanel(page);
      await expect(
        page.getByText('The gate is open and the bridge is mended! Walk across to Lookout Point.'),
      ).toBeVisible();
    });

    await test.step('the bridge carries the child to Lookout Point, its sides hold', async () => {
      await page.evaluate(() => window.__laiE2E!.standAt(0, -33.5, Math.PI));
      const across = await walk(page, 'w', 6000);
      expect(across.z).toBeLessThan(-40.4);
      // Off the bridge's side into the channel: the side colliders stop the child.
      await page.evaluate(() => window.__laiE2E!.standAt(0, -38.4, Math.PI / 2));
      const side = await walk(page, 'w');
      expect(side.x).toBeLessThan(1.7);
    });

    await test.step('the spyglass is a replay: kind note, play again, no reward', async () => {
      const before = await (
        await api(page.request, parent).get(`children/${childId}/progress/`)
      ).json();
      let issuedPromise = challengeResponse(page);
      await (await approach(page, 'cove-lookout-spyglass')).click();
      let issued = await issuedFrom(await issuedPromise);
      let graded = answerResponse(page);
      await answerInPanel(page, issued, pictureAnswer(issued));
      expect((await (await graded).json()).correct).toBe(true);
      await expect(page.getByText('Great counting!')).toBeVisible();
      await expect(page.getByText('You found')).toHaveCount(0);
      issuedPromise = challengeResponse(page);
      await page.getByRole('button', { name: 'Play again' }).click();
      issued = await issuedFrom(await issuedPromise);
      graded = answerResponse(page);
      await answerInPanel(page, issued, pictureAnswer(issued));
      expect((await (await graded).json()).correct).toBe(true);
      await closePanel(page);
      const after = await (
        await api(page.request, parent).get(`children/${childId}/progress/`)
      ).json();
      expect(after.inventory).toEqual(before.inventory);
    });

    await test.step('backpack: each keepsake once, quest done', async () => {
      await page.getByRole('button', { name: /^Backpack/ }).click();
      const items = page.getByRole('list', { name: 'My backpack' }).getByRole('listitem');
      const names = await items.allInnerTexts();
      expect(names.length).toBeGreaterThanOrEqual(4);
      expect(new Set(names).size).toBe(names.length);
      await expect(page.getByRole('list', { name: 'My quests' })).toContainText('Done');
      await closePanel(page);
    });
  });

  test('progress survives a reload: no new celebration, bridge already there', async ({
    page,
    problems,
  }) => {
    void problems;
    await signInAs(page, parent);
    await enterCove(page, childId);
    await page.reload();
    await enterCove(page, childId);
    await expect(page.getByText('The gate is open and the bridge is mended!')).toHaveCount(0);
    await page.evaluate(() => window.__laiE2E!.standAt(0, -33.5, Math.PI));
    expect((await walk(page, 'w', 6000)).z).toBeLessThan(-40.4);
    await (await approach(page, 'cove-chest')).click();
    await expect(page.getByText('This chest is already open.')).toBeVisible();
  });
});

test.describe('controls, full screen and exit', () => {
  test('keyboard walking moves the player and walls stop them @tablet', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const { parent, childId } = await parentWithChild(request, 'tr-controls', {
      nickname: 'Sam',
      ageBand: 'SPROUT',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    const start = await page.evaluate(() => window.__laiE2E!.player());
    const moved = await walk(page, 'ArrowUp', 1500);
    expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(0.5);
    // The island edge holds: walking outward never leaves the bounds.
    await page.evaluate(() => window.__laiE2E!.standAt(0, 0, -Math.PI / 2));
    const edge = await walk(page, 'w', 15000);
    expect(Math.abs(edge.x)).toBeLessThan(40);
  });

  test('a touch drag on the left of the stage walks the player @tablet', async ({
    page,
    request,
    problems,
  }, info) => {
    void problems;
    test.skip(info.project.name !== 'tablet', 'touch input is a tablet-project check');
    const { parent, childId } = await parentWithChild(request, 'tr-touch', {
      nickname: 'Pia',
      ageBand: 'SPROUT',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    const box = (await page.locator('canvas').boundingBox())!;
    const x = box.x + box.width * 0.25;
    const y = box.y + box.height * 0.7;
    const start = await page.evaluate(() => window.__laiE2E!.player());
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + dy, id: 1 }],
      });
    await touch('touchStart', 0);
    // Drag up (forward) and hold; the move vector stays while the finger is down.
    await touch('touchMove', -60);
    await expect
      .poll(async () => {
        const now = await page.evaluate(() => window.__laiE2E!.player());
        return Math.hypot(now.x - start.x, now.z - start.z);
      })
      .toBeGreaterThan(0.5);
    await touch('touchEnd', 0);
  });

  test('the action prompt works by tap or click and is the only one @tablet', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const { parent, childId } = await parentWithChild(request, 'tr-tap', {
      nickname: 'Ada',
      ageBand: 'EXPLORER',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    const prompt = await approach(page, 'cove-pip');
    if ((await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) === true) {
      await prompt.tap();
      // No keyboard is assumed on a touch device, so the E badge is not shown.
      await expect(prompt.locator('kbd')).toHaveCount(0);
    } else {
      await prompt.click();
    }
    await expect(page.getByRole('dialog', { name: 'Pirate Pip' })).toBeVisible();
    await page.getByRole('button', { name: 'Maybe later' }).click();
    await expect(page.getByText("Find Pip's treasures")).toHaveCount(0);
    // Walking away takes focus and the prompt away.
    await page.evaluate(() => window.__laiE2E!.standAt(-30, -2, 0));
    await expect(page.getByRole('button', { name: /^Talk: Pirate Pip$/ })).toHaveCount(0);
  });

  test('full screen keeps Backpack, Hint and Exit, and exits cleanly', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const { parent, childId } = await parentWithChild(request, 'tr-fullscreen', {
      nickname: 'Kit',
      ageBand: 'PATHFINDER',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    for (const name of ['Hint', 'Backpack', 'Exit full screen']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Go back to the harbor' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Backpack' }).click();
    await expect(page.getByRole('heading', { name: 'My backpack' })).toBeVisible();
    await closePanel(page);
    await page.getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  });

  test('exit needs no arithmetic challenge and nothing is lost', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const { parent, childId } = await parentWithChild(request, 'tr-exit', {
      nickname: 'Lou',
      ageBand: 'PATHFINDER',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    await page.getByRole('link', { name: 'Go back to the harbor' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/island/${childId}$`));
    await expect(page.getByText(/How many coins/)).toHaveCount(0);
    await page.goto(covePath(childId));
    await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
  });
});

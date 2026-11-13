import type { Page } from '@playwright/test';
import { api, expect, parentWithChild, signInAs, test, type Parent } from './support/fixtures';
import {
  answerInPanel,
  answerResponse,
  approach,
  challengeResponse,
  enterCove,
  issuedFrom,
  pictureAnswer,
  wrongAnswer,
  type E2EProbe,
} from './support/cove';
import { areaNpcs, shot, type RuntimeRead } from './support/npc';

/**
 * Treasure Rush with Pirate Pip served by the NPC Manager (docs/NPC_MANAGER_QA_REPORT.md,
 * Phase 4), in a real browser with software WebGL against the e2e Django. Runs after
 * npc-1-admin.spec.ts, which leaves NPC release 3 (Pip and Quill) ACTIVE.
 *
 * What a child sees and does is driven through the UI (prompt, panel, keyboard); the e2e probe
 * only stands the player somewhere and reports what the scene draws (`npcs()`), which managed NPC
 * roots exist, whether they are visible, and their animator state.
 */

type Npc = ReturnType<E2EProbe['npcs']>[number];
const npcs = (page: Page): Promise<Npc[]> => page.evaluate(() => window.__laiE2E!.npcs());
const pips = async (page: Page) => (await npcs(page)).filter((n) => n.npcId === 'pirate-pip');

const PIP = 'Pirate Pip';
const dialog = (page: Page) => page.getByRole('dialog', { name: PIP });
/** An unprompted line: the non-modal speech bubble (QA F-B), never a dialog. */
const bubble = (page: Page) => page.getByRole('region', { name: PIP });

/** Waits until the managed Pip has loaded his model and stands visible. */
async function managedPip(page: Page): Promise<Npc> {
  await expect
    .poll(
      async () => (await pips(page)).filter((n) => n.visible && n.placeholder === false).length,
      {
        timeout: 30_000,
      },
    )
    .toBe(1);
  return (await pips(page))[0]!;
}

/** Closes Pip's panel or unprompted-line bubble through its own Close button. */
async function closePip(page: Page) {
  // An ambient line (greeting, welcome back) may still be arriving; give it a moment.
  await page.waitForTimeout(800);
  for (const open of [dialog(page), bubble(page)]) {
    if (await open.count()) await open.getByRole('button', { name: 'Close' }).click();
    await expect(open).toHaveCount(0);
  }
}

async function inventory(page: Page, parent: Parent, childId: string) {
  const progress = (await (
    await api(page.request, parent).get(`children/${childId}/progress/`)
  ).json()) as { inventory: unknown };
  return progress.inventory;
}

test.describe.serial('Treasure Rush: Pirate Pip from the NPC Manager', () => {
  let parent: Parent;
  let childId: string;

  test.beforeAll(async ({ request }) => {
    ({ parent, childId } = await parentWithChild(request, 'npc-cove', {
      nickname: 'Mira',
      ageBand: 'PATHFINDER',
    }));
  });

  test('exactly one Pip, managed, on the authored spot, greeting once', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const read = (await (
      await areaNpcs(request, parent, childId, 'treasure-rush-cove')
    ).json()) as RuntimeRead;
    expect(read.release).toBe(3);
    const placement = read.placements!.find((p) => p.npcId === 'pirate-pip')! as unknown as {
      position: { x: number; z: number };
      rotationY: number;
    };

    await signInAs(page, parent);
    // Pip's greeting is voiced: the acceptance stack synthesizes it with the fake provider.
    const spoken = page.waitForResponse(
      (r) => /\/audio\/speech\/$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 },
    );
    const clip = page.waitForResponse((r) => /\/speech-files\/[^/]+\/speech\.mp3/.test(r.url()), {
      timeout: 60_000,
    });
    await enterCove(page, childId);
    const pip = await managedPip(page);
    const speech = await spoken;
    expect(speech.status()).toBe(200);
    const said = (
      (await speech.json()) as { speech: { url: string; text: string; cached: boolean } }
    ).speech;
    expect(said.text).toContain('Ahoy, friend!');
    expect(said.url).toMatch(/\/speech-files\/[^/]+\/speech\.mp3/);
    const audio = await clip;
    expect(audio.status()).toBe(200);
    expect(audio.headers()['content-type']).toBe('audio/mpeg');
    // The same line again is served from the cache, not synthesized twice.
    const again = await api(page.request, parent).post(
      `children/${childId}/audio/speech/`,
      speech.request().postDataJSON() as Record<string, unknown>,
    );
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { speech: { cached: boolean } }).speech.cached).toBe(true);
    // One Pip on screen: the managed one; the manifest Pip is handed over and hidden.
    expect(await page.evaluate(() => window.__laiE2E!.entityVisible('cove-pip'))).toBe(false);
    expect((await npcs(page)).filter((n) => n.visible)).toHaveLength(1);
    expect(pip.x).toBeCloseTo(placement.position.x, 1);
    expect(pip.z).toBeCloseTo(placement.position.z, 1);

    // First visit: the on_spawn greeting, once, as a non-modal bubble with captions (F-B):
    // no dialog, no focus taken, and the HUD (Hint, Full screen) stays usable.
    await expect(bubble(page)).toContainText('Ahoy, friend! Welcome to Pirate Landing.');
    await expect(dialog(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[data-npc-ambient]'))),
    ).toBe(false);
    await expect(page.getByRole('button', { name: 'Hint', exact: true })).toBeVisible();
    await shot(page, 'cove-01-first-greeting');
    await closePip(page);
    expect((await pips(page)).length).toBe(1);
  });

  test('the Talk prompt appears only within reach; dialogue opens, animates and closes', async ({
    page,
    problems,
  }) => {
    void problems;
    await signInAs(page, parent);
    await enterCove(page, childId);
    await managedPip(page);
    await closePip(page); // a return-visit line may greet first

    const talk = page.getByRole('button', { name: `Talk to ${PIP}` });
    // Far away: no prompt.
    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 9));
    await page.waitForTimeout(500);
    await expect(talk).toHaveCount(0);
    // Within reach: the prompt.
    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 1.6));
    await expect(talk).toBeVisible();
    await shot(page, 'cove-02-talk-prompt');

    await talk.click();
    await expect(dialog(page)).toContainText('Will you help me?');
    // Focus moves into the dialog (first choice).
    await expect(dialog(page).getByRole('button', { name: 'Yes, I will help!' })).toBeVisible();
    // Pip talks while the line is up (dialogue band overlay, or the talk clip as base).
    await expect
      .poll(async () => {
        const [pip] = await pips(page);
        return pip?.animation?.overlay?.state ?? pip?.animation?.base;
      })
      .toMatch(/talk|wave/);
    await shot(page, 'cove-03-mission-offer');

    // "Maybe later" closes and starts nothing.
    await dialog(page).getByRole('button', { name: 'Maybe later' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("Find Pip's treasures")).toHaveCount(0);
    // Focus goes back to the prompt.
    await expect(talk).toBeFocused();
    // Back to idle once the conversation is over.
    await expect
      .poll(async () => (await pips(page))[0]?.animation?.overlay ?? null, { timeout: 10_000 })
      .toBeNull();

    // Walking away hides the prompt.
    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 9));
    await expect(talk).toHaveCount(0);
  });

  test('keyboard: E opens, Tab stays inside, Escape closes and focus returns', async ({
    page,
    problems,
  }) => {
    void problems;
    await signInAs(page, parent);
    await enterCove(page, childId);
    await managedPip(page);
    await closePip(page);
    await approach(page, 'cove-pip');
    await page.keyboard.press('e');
    await expect(dialog(page)).toContainText('Will you help me?');
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('[role="dialog"]')?.getAttribute('role') ?? null,
        ),
      ).toBe('dialog');
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("Find Pip's treasures")).toHaveCount(0);
  });

  test('accepting the quest, Pip reacting to answers, rewards exactly once', async ({
    page,
    problems,
  }) => {
    void problems;
    test.setTimeout(180_000);
    await signInAs(page, parent);
    await enterCove(page, childId);
    await managedPip(page);
    await closePip(page);
    const before = await inventory(page, parent, childId);

    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 1.6));
    await page.getByRole('button', { name: `Talk to ${PIP}` }).click();
    await dialog(page).getByRole('button', { name: 'Yes, I will help!' }).click();
    await expect(page.getByText("Find Pip's treasures: 0 of 4")).toBeVisible();
    await closePip(page);
    await shot(page, 'cove-04-quest-accepted');

    // A wrong answer: the chest panel first, then one hint line from Pip once it is closed.
    let issuedPromise = challengeResponse(page);
    await (await approach(page, 'cove-chest')).click();
    let issued = await issuedFrom(await issuedPromise);
    let graded = answerResponse(page);
    await answerInPanel(page, issued, wrongAnswer(issued));
    expect(((await (await graded).json()) as { correct: boolean }).correct).toBe(false);
    await expect(dialog(page)).toHaveCount(0); // Pip never covers the chest panel
    issuedPromise = challengeResponse(page);
    await page.getByRole('button', { name: 'Try again' }).first().click();
    issued = await issuedFrom(await issuedPromise);

    // The right answer: reward reveal first, then Pip celebrates and speaks.
    graded = answerResponse(page);
    await answerInPanel(page, issued, pictureAnswer(issued));
    expect(((await (await graded).json()) as { correct: boolean }).correct).toBe(true);
    await expect(page.getByText('You found', { exact: true })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^(Close|Keep exploring|Got it)$/ }).click();
    await expect(bubble(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await shot(page, 'cove-05-pip-reacts-to-treasure');
    await closePip(page);
    await expect(page.getByText("Find Pip's treasures: 1 of 4")).toBeVisible();

    // Rewards: one new keepsake from the chest; talking to Pip again adds nothing.
    const afterChest = await inventory(page, parent, childId);
    expect(JSON.stringify(afterChest)).not.toBe(JSON.stringify(before));
    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 1.6));
    await page.getByRole('button', { name: `Talk to ${PIP}` }).click();
    await expect(dialog(page)).toContainText('The treasure is waiting for you.');
    await closePip(page);
    await page.getByRole('button', { name: `Talk to ${PIP}` }).click();
    await closePip(page);
    expect(await inventory(page, parent, childId)).toEqual(afterChest);
    // The opened chest stays open and gives nothing twice.
    await (await approach(page, 'cove-chest')).click();
    await expect(page.getByText('This chest is already open.')).toBeVisible();
    await page.getByRole('button', { name: /^(Close|Keep exploring|Got it)$/ }).click();
    expect(await inventory(page, parent, childId)).toEqual(afterChest);
    expect((await pips(page)).length).toBe(1);
  });

  test('a return visit: progress kept, the welcome-back line, still one Pip', async ({
    page,
    problems,
  }) => {
    void problems;
    await signInAs(page, parent);
    await enterCove(page, childId);
    await managedPip(page);
    await expect(page.getByText("Find Pip's treasures: 1 of 4")).toBeVisible();
    // QA-D3: the return visit is recognised on a normal resume (the session is still open).
    await expect(bubble(page)).toContainText('Ahoy again, friend! Welcome back');
    await expect(dialog(page)).toHaveCount(0);
    await shot(page, 'cove-08-welcome-back');
    await closePip(page);
    // Leave and come back five times: never two Pips, and the scene is rebuilt cleanly.
    for (let i = 0; i < 5; i += 1) {
      await page.reload();
      await enterCove(page, childId);
      await managedPip(page);
      expect((await npcs(page)).filter((n) => n.npcId === 'pirate-pip')).toHaveLength(1);
    }
  });
});

test.describe('Treasure Rush: legacy Pip when the NPC Manager serves nothing', () => {
  for (const [label, answer] of [
    [
      'no active release (404)',
      { status: 404, body: { error: { code: 'no_active_release', message: 'No NPCs.' } } },
    ],
    // What the dev proxy answers when Django is down.
    [
      'Django unreachable for NPCs',
      { status: 502, body: { error: { code: 'bad_gateway', message: 'Down.' } } },
    ],
  ] as const) {
    test(`fallback: ${label}`, async ({ page, request, problems }) => {
      problems.allowConsole(/npc host|Failed to load resource/);
      problems.allowStatus(/\/npcs\//, 404);
      problems.allowStatus(/\/npcs\//, 502);
      const { parent, childId } = await parentWithChild(request, `npc-legacy-${label.length}`, {
        nickname: 'Noor',
        ageBand: 'PATHFINDER',
      });
      await page.route(
        /\/api\/v1\/children\/[^/]+\/regions\/treasure-rush-cove\/npcs\/$/,
        (route) => route.fulfill({ status: answer.status, json: answer.body }),
      );
      await signInAs(page, parent);
      await enterCove(page, childId);
      await page.waitForTimeout(1500);
      expect(await pips(page)).toHaveLength(0);
      expect(await page.evaluate(() => window.__laiE2E!.entityVisible('cove-pip'))).toBe(true);
      const prompt = await approach(page, 'cove-pip');
      await prompt.click();
      await expect(dialog(page)).toContainText('Will you help me?');
      await dialog(page).getByRole('button', { name: 'Yes, I will help!' }).click();
      await expect(page.getByText("Find Pip's treasures: 0 of 4")).toBeVisible();
      await shot(page, `cove-06-legacy-fallback-${answer.status}`);
    });
  }

  test('a model that fails to load stands as a placeholder you can still talk to', async ({
    page,
    request,
    problems,
  }) => {
    problems.allowConsole(/npc|Failed to load resource|model|gltf/i);
    const { parent, childId } = await parentWithChild(request, 'npc-placeholder', {
      nickname: 'Ivo',
      ageBand: 'EXPLORER',
    });
    // Only the model file: the manifest and the NPC loader both still resolve the asset.
    await page.route(/\/models\/npc-pip\.gltf|asset-files\/.*npc-pip/, (route) =>
      route.fulfill({ status: 404, body: 'gone' }),
    );
    await signInAs(page, parent);
    await enterCove(page, childId);
    await expect
      .poll(async () => (await pips(page)).map((n) => [n.visible, n.placeholder]), {
        timeout: 30_000,
      })
      .toEqual([[true, true]]);
    expect(await page.evaluate(() => window.__laiE2E!.entityVisible('cove-pip'))).toBe(false);
    await closePip(page);
    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 1.6));
    await page.getByRole('button', { name: `Talk to ${PIP}` }).click();
    await expect(dialog(page)).toContainText('Will you help me?');
    await shot(page, 'cove-07-placeholder-pip');
  });
});

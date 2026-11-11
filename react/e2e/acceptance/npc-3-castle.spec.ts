import type { Page } from '@playwright/test';
import { expect, parentWithChild, signInAs, test, type AgeBand } from './support/fixtures';
import { walk, type E2EProbe } from './support/cove';
import { placeNpcs, shot, type RuntimeRead } from './support/npc';

/**
 * Storykeeper's Castle with Keeper Quill served by the NPC Manager
 * (docs/NPC_MANAGER_QA_REPORT.md, Phase 4). Runs after npc-1-admin.spec.ts, which leaves
 * NPC release 3 (Pip and Quill) ACTIVE. Quill is a Place-level placement (the castle has no 3D
 * Area in Django).
 *
 * Not automatable here, and recorded as such in the QA report: the castle's tale, its quest log
 * and backpack run on Amplify Data, which the local e2e stack does not provide (the page shows
 * "We could not load your backpack just now"). So the tale's start, mid-tale tap, gestures and
 * completion, and the quest accept's effect on the castle quest log, stay owner checks (B13).
 */

type Npc = ReturnType<E2EProbe['npcs']>[number];
const QUILL = 'Keeper Quill';
const npcs = (page: Page): Promise<Npc[]> => page.evaluate(() => window.__laiE2E!.npcs());
const dialog = (page: Page) => page.getByRole('dialog', { name: QUILL });
const castlePath = (childId: string) => `/island/${childId}/explore/storykeeper-castle`;

async function enterCastle(page: Page, childId: string) {
  await page.goto(castlePath(childId));
  await expect
    .poll(() => page.evaluate(() => window.__laiE2E?.entities().length ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(5);
}

async function managedQuill(page: Page): Promise<Npc> {
  await expect
    .poll(
      async () =>
        (await npcs(page)).filter(
          (n) => n.npcId === 'keeper-quill' && n.visible && n.placeholder === false,
        ).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  return (await npcs(page)).find((n) => n.npcId === 'keeper-quill')!;
}

async function child(request: Parameters<typeof parentWithChild>[0], ageBand: AgeBand) {
  return parentWithChild(request, `npc-castle-${ageBand.toLowerCase()}`, {
    nickname: 'Quinn',
    ageBand,
  });
}

/**
 * The castle's Amplify-backed backpack and quest log are not available in the e2e stack; and
 * Quill has a voice profile while speech is disabled, so each voiced line is refused with
 * `503 speech_unavailable` and read as a caption (ADR-049 behaviour, see the QA report).
 */
function allowAmplify(problems: {
  allowConsole(pattern: RegExp): void;
  allowStatus(pattern: RegExp, status: number): void;
}) {
  problems.allowConsole(/amplify|graphql|backpack|Amplify|No credentials|UserUnAuthenticated/i);
  problems.allowConsole(/Failed to load resource: the server responded with a status of 503/);
  problems.allowStatus(/\/audio\/speech\/$/, 503);
}

test.describe.serial("Storykeeper's Castle: Keeper Quill from the NPC Manager", () => {
  test('exactly one Quill, managed, on his spot and facing the entry hall', async ({
    page,
    request,
    problems,
  }) => {
    allowAmplify(problems);
    const { parent, childId } = await child(request, 'PATHFINDER');
    const read = (await (
      await placeNpcs(request, parent, childId, 'storykeeper-castle')
    ).json()) as RuntimeRead;
    const placement = read.placements!.find((p) => p.npcId === 'keeper-quill') as unknown as {
      position: { x: number; z: number };
      rotationY: number;
    };
    await signInAs(page, parent);
    await enterCastle(page, childId);
    const quill = await managedQuill(page);
    expect(await page.evaluate(() => window.__laiE2E!.entityVisible('keeper-quill'))).toBe(false);
    expect((await npcs(page)).filter((n) => n.visible)).toHaveLength(1);
    expect(quill.x).toBeCloseTo(placement.position.x, 1);
    expect(quill.z).toBeCloseTo(placement.position.z, 1);
    expect(quill.animation?.clip).toBe('Idle');
    await shot(page, 'castle-01-managed-quill');

    // Stationary: still on his spot after a while, and the child cannot walk through him.
    await page.evaluate(
      ({ x, z }) => window.__laiE2E!.standAt(x + 3, z, -Math.PI / 2),
      placement.position,
    );
    const stopped = await walk(page, 'w', 5000);
    expect(stopped.x).toBeGreaterThan(placement.position.x + 0.3);
    const later = (await npcs(page)).find((n) => n.npcId === 'keeper-quill')!;
    expect(later.x).toBeCloseTo(placement.position.x, 1);
    expect(later.z).toBeCloseTo(placement.position.z, 1);
  });

  test('a Pathfinder: the prompt within reach, the first meeting, the quest offer, then the rules', async ({
    page,
    request,
    problems,
  }) => {
    allowAmplify(problems);
    const { parent, childId } = await child(request, 'PATHFINDER');
    await signInAs(page, parent);
    await enterCastle(page, childId);
    await managedQuill(page);
    const talk = page.getByRole('button', { name: `Talk to ${QUILL}` });
    await page.evaluate(() => window.__laiE2E!.standFacing('keeper-quill', 9));
    await page.waitForTimeout(500);
    await expect(talk).toHaveCount(0);
    await page.evaluate(() => window.__laiE2E!.standFacing('keeper-quill', 1.6));
    await expect(talk).toBeVisible();

    await talk.click();
    await expect(dialog(page)).toContainText('Every story here is missing one thing: your ideas.');
    await expect
      .poll(async () => (await npcs(page))[0]?.animation?.overlay?.state ?? null)
      .toBe('wave');
    await dialog(page).getByRole('button', { name: 'I have lots of ideas!' }).click();
    await expect(dialog(page)).toContainText('Will you help me tell a brand new tale?');
    // QA-D2: a captions-only talk line animates.
    await expect
      .poll(async () => (await npcs(page))[0]?.animation?.overlay?.state ?? null)
      .toBe('talk');
    await expect(dialog(page).getByRole('button', { name: 'Yes, I will help!' })).toBeVisible();
    // QA-D4: speech is disabled, so the refused line offers no "Hear it again".
    await expect(dialog(page).getByRole('button', { name: 'Hear it again' })).toHaveCount(0);
    await shot(page, 'castle-02-quest-offer');
    await dialog(page).getByRole('button', { name: 'I am just visiting.' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(talk).toBeFocused();

    // The first meeting is once per child: the next talk is what every story needs.
    await talk.click();
    await expect(dialog(page)).toContainText(
      'Every good story needs three things: a hero, a problem to solve, and a happy ending.',
    );
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('accepting the offer goes to the castle quest flow without breaking the page', async ({
    page,
    request,
    problems,
  }) => {
    allowAmplify(problems);
    const { parent, childId } = await child(request, 'EXPLORER');
    await signInAs(page, parent);
    await enterCastle(page, childId);
    await managedQuill(page);
    await page.evaluate(() => window.__laiE2E!.standFacing('keeper-quill', 1.6));
    await page.getByRole('button', { name: `Talk to ${QUILL}` }).click();
    await dialog(page).getByRole('button', { name: 'I have lots of ideas!' }).click();
    await dialog(page).getByRole('button', { name: 'Yes, I will help!' }).click();
    await expect(dialog(page)).toContainText('Walk into the story hall when you are ready');
    await shot(page, 'castle-03-quest-accepted-line');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await expect(dialog(page)).toHaveCount(0);
    // The page stays usable: no error screen, Quill still there, still one Quill.
    await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
    expect((await npcs(page)).filter((n) => n.visible)).toHaveLength(1);
  });

  test('a Sprout gets the short greeting with no quest offer', async ({
    page,
    request,
    problems,
  }) => {
    allowAmplify(problems);
    const { parent, childId } = await child(request, 'SPROUT');
    await signInAs(page, parent);
    await enterCastle(page, childId);
    await managedQuill(page);
    await page.evaluate(() => window.__laiE2E!.standFacing('keeper-quill', 1.6));
    await page.getByRole('button', { name: `Talk to ${QUILL}` }).click();
    await expect(dialog(page)).toContainText('your ideas');
    await dialog(page).getByRole('button', { name: 'I have lots of ideas!' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Yes, I will help!' })).toHaveCount(0);
  });

  test('leaving and coming back never doubles Quill', async ({ page, request, problems }) => {
    allowAmplify(problems);
    const { parent, childId } = await child(request, 'PATHFINDER');
    await signInAs(page, parent);
    await enterCastle(page, childId);
    await managedQuill(page);
    await page.evaluate(() => window.__laiE2E!.standFacing('keeper-quill', 1.6));
    await page.getByRole('button', { name: `Talk to ${QUILL}` }).click();
    await page.keyboard.press('Escape');
    for (let i = 0; i < 3; i += 1) {
      await page.reload();
      await enterCastle(page, childId);
      await managedQuill(page);
      expect((await npcs(page)).filter((n) => n.npcId === 'keeper-quill')).toHaveLength(1);
    }
    // No welcome-back line here: the castle raises on_return_visit only when its tale resumes,
    // and the tale runs on Amplify sessions (not in this stack). Owner check B13.9.
    await shot(page, 'castle-04-return-one-quill');
  });
});

test.describe("Storykeeper's Castle: legacy Quill when the NPC Manager serves nothing", () => {
  for (const status of [404, 502]) {
    test(`fallback on ${status}`, async ({ page, request, problems }) => {
      allowAmplify(problems);
      problems.allowConsole(/npc host|Failed to load resource/);
      problems.allowStatus(/\/npcs\//, status);
      const { parent, childId } = await child(request, 'PATHFINDER');
      await page.route(/\/places\/storykeeper-castle\/npcs\/$/, (route) =>
        route.fulfill({ status, json: { error: { code: 'no_active_release', message: 'x' } } }),
      );
      await signInAs(page, parent);
      await enterCastle(page, childId);
      await page.waitForTimeout(1500);
      expect(await npcs(page)).toHaveLength(0);
      expect(await page.evaluate(() => window.__laiE2E!.entityVisible('keeper-quill'))).toBe(true);
      // From the entry hall side, facing him (the probe's own direction search can land behind
      // his lectern, which hides him from the eye-height reticle).
      const spot = (await page.evaluate(() => window.__laiE2E!.entities())).find(
        (e) => e.entityId === 'keeper-quill',
      )!;
      await page.evaluate(({ x, z }) => window.__laiE2E!.standAt(x + 2.2, z, -Math.PI / 2), spot);
      // Legacy Quill is shorter than the eye-height reticle: glance down at him.
      await page.evaluate(() => window.__laiE2E!.look(-0.35));
      await expect.poll(() => page.evaluate(() => window.__laiE2E!.focused())).toBe('keeper-quill');
      await expect(page.getByText('Keeper Quill: press E to talk')).toBeVisible();
      await page.keyboard.press('e');
      // The legacy conversation (features/npc) opens; no managed panel is involved. Its lines
      // come from Amplify, absent here, so it shows its own calm offline line.
      const legacy = page.getByRole('dialog', { name: QUILL });
      await expect(legacy).toContainText(/ideas|story|castle|too busy to talk just now/i);
      await legacy.getByRole('button', { name: 'Not now' }).click();
      await expect(legacy).toHaveCount(0);
      await shot(page, `castle-05-legacy-fallback-${status}`);
    });
  }
});

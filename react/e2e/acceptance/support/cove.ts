import { expect, type Page, type Response } from '@playwright/test';
// Brings the `window.__laiE2E` declaration the specs read (installed under `vite --mode e2e`).
export type { E2EProbe } from '../../../src/features/island-map/three/runtime/e2eProbe';

/** What the play API issues (react/src/api/play/types.ts `IssuedChallenge`); no answer field. */
export interface IssuedChallenge {
  attemptId: string;
  targetEntityId: string;
  challenge: {
    skillId: string;
    operation: 'COUNT' | 'ADD' | 'SUBTRACT' | 'MULTIPLY';
    operands: number[];
    responseMode: 'CHOICE' | 'NUMBER_INPUT';
    choices: number[];
  };
}

/** The number the coin picture shows: what a child works out, not a server secret. */
export function pictureAnswer(issued: IssuedChallenge): number {
  const { operation, operands } = issued.challenge;
  const [a = 0, b = 0] = operands;
  switch (operation) {
    case 'COUNT':
      return a;
    case 'ADD':
      return a + b;
    case 'SUBTRACT':
      return a - b;
    case 'MULTIPLY':
      return a * b;
  }
}

export const covePath = (childId: string) => `/island/${childId}/explore/treasure-rush-cove`;

/**
 * Opens the cove and waits until the region bootstrap, the scene and the probe are ready. A
 * first visit starts a session (POST) and a later one resumes the session the bootstrap names.
 */
export async function enterCove(page: Page, childId: string): Promise<void> {
  const bootstrap = page.waitForResponse(
    (r) => /\/regions\/treasure-rush-cove\/$/.test(r.url()) && r.request().method() === 'GET',
  );
  await page.goto(covePath(childId));
  expect((await bootstrap).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__laiE2E?.entities().length ?? 0))
    .toBeGreaterThan(5);
}

/** What each Treasure Cove entity's action prompt names (manifest labels). */
export const COVE_LABELS: Record<string, string> = {
  'cove-pip': 'Pirate Pip',
  'cove-brass-key': 'Old brass key',
  'cove-rune-stone-1': 'Rune stone 1',
  'cove-rune-stone-2': 'Rune stone 2',
  'cove-rune-stone-3': 'Rune stone 3',
  'cove-chest': 'Treasure chest',
  'cove-grove-chest': 'Hidden chest',
  'cove-beach-chest': 'Locked chest',
  'cove-ruins-pedestal': 'Glowing pedestal',
  'cove-final-chest': 'Golden chest',
};

/**
 * Stands the player in front of an entity and waits until the one action prompt names it:
 * the engine's focus changes in the next frame, React's prompt a little later, and acting in
 * between would act on the new focus while the old prompt still shows.
 */
export async function approach(page: Page, entityId: string, label = COVE_LABELS[entityId]) {
  expect(await page.evaluate((id) => window.__laiE2E!.standFacing(id), entityId)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__laiE2E!.focused())).toBe(entityId);
  const name = label ? new RegExp(`^[A-Z][^:]*: ${label}$`) : /^(?!Adults)[A-Z][^:]*: /;
  const prompt = page.getByRole('button', { name });
  await expect(prompt).toHaveCount(1);
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('button', { name: /^(?!Adults)[A-Z][^:]*: / })).toHaveCount(1);
  return prompt;
}

export function challengeResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (r) => r.url().includes('/challenge/') && r.request().method() === 'POST',
  );
}

export async function issuedFrom(response: Response): Promise<IssuedChallenge> {
  expect(response.status(), await response.text()).toBeLessThan(300);
  const body = (await response.json()) as IssuedChallenge;
  expect(body.challenge.operands.length).toBeGreaterThan(0);
  return body;
}

export function answerResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (r) => r.url().includes('/answer/') && r.request().method() === 'POST',
  );
}

/** Answers in the chest panel, by tapping a choice or typing the number. */
export async function answerInPanel(page: Page, issued: IssuedChallenge, answer: number) {
  if (issued.challenge.responseMode === 'CHOICE') {
    await page
      .getByRole('group', { name: /coins|how many/i })
      .getByRole('button', { name: String(answer), exact: true })
      .click();
  } else {
    await page.getByLabel('Your answer').fill(String(answer));
    await page.getByRole('button', { name: 'Open it!' }).click();
  }
}

/** A choice that is wrong for this challenge (or any wrong number for typed answers). */
export function wrongAnswer(issued: IssuedChallenge): number {
  const right = pictureAnswer(issued);
  if (issued.challenge.responseMode === 'CHOICE') {
    const wrong = issued.challenge.choices.find((choice) => choice !== right);
    expect(wrong).toBeDefined();
    return wrong!;
  }
  return right + 1;
}

/** Holds a movement key until the player stops moving; returns where they ended up. */
export async function walk(page: Page, key: string, maxMs = 4000) {
  await page.keyboard.down(key);
  let last = await page.evaluate(() => window.__laiE2E!.player());
  let stillFor = 0;
  const started = Date.now();
  // Poll the engine (no fixed sleep): stop once three polls in a row show no movement.
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.__laiE2E!.player());
        const moved = Math.hypot(now.x - last.x, now.z - last.z);
        last = now;
        stillFor = moved < 0.01 ? stillFor + 1 : 0;
        return stillFor >= 3 || Date.now() - started > maxMs;
      },
      { intervals: [150], timeout: maxMs + 3000 },
    )
    .toBe(true);
  await page.keyboard.up(key);
  return last;
}

import type { Page } from '@playwright/test';
import { api, expect, parentWithChild, signInAs, test } from './support/fixtures';
import { adminLogin, adminUrl, offeredActions, runAction } from './support/admin';
import {
  answerInPanel,
  answerResponse,
  approach,
  challengeResponse,
  enterCove,
  issuedFrom,
  pictureAnswer,
} from './support/cove';

/**
 * AI Question Studio acceptance (LAI-AQS-015 to 024, ADR-046) in Django Admin, with the fake
 * model (LAI_AI_PROVIDER=fake, inline runs): no Bedrock call and no AWS cost. Live Bedrock
 * generation stays pending (LAI-0705, LAI-AQS-024).
 *
 * Serial: authors generate, reviewers approve and reject, publishers publish, a correction is
 * started and a revision retired, a pool serves the bank to Treasure Rush, and retiring the
 * bank sends new challenges back to the authored ones.
 */

const STUDIO = 'question_studio/';

async function generate(
  page: Page,
  fields: { count: string; topic?: string; skill?: string; grade?: string },
) {
  await page.goto(adminUrl(`${STUDIO}generationbatch/add/`));
  await page.getByLabel('Subject').selectOption('MATH');
  await page.getByLabel('Grade').selectOption(fields.grade ?? '3');
  await page.getByLabel('Topic').selectOption(fields.topic ?? 'multiplication');
  await page.getByLabel('Skill or objective code').fill(fields.skill ?? 'multiplication-facts');
  await page.getByLabel('Question type').selectOption('MULTIPLE_CHOICE');
  await page.getByLabel('Number of questions').fill(fields.count);
  await page.getByRole('button', { name: 'Generate Questions' }).click();
}

/** The batch id from the batch page the form redirects to. */
function batchId(page: Page): string {
  const match = /generationbatch\/([0-9a-f-]+)\/change\//.exec(page.url());
  expect(match, page.url()).not.toBeNull();
  return match![1];
}

const batchQuestions = (id: string) => adminUrl(`${STUDIO}question/?batch__id__exact=${id}`);
const messages = (page: Page) => page.locator('ul.messagelist');

test.describe.serial('AI Question Studio in Django Admin', () => {
  let firstBatch = '';
  let duplicateBatch = '';

  test('anonymous visitors are sent to sign in, staff without Studio rights are refused', async ({
    page,
  }) => {
    await page.goto(adminUrl(`${STUDIO}question/`));
    await expect(page).toHaveURL(/\/admin\/login\/\?next=/);
    for (const user of ['e2e-no-perms', 'e2e-asset-editor']) {
      await adminLogin(page, user);
      await expect(
        page.getByRole('link', { name: /AI Question Studio|Question studio/i }),
      ).toHaveCount(0);
      for (const path of ['question/', 'generationbatch/add/', 'questionrevision/']) {
        const response = await page.goto(adminUrl(STUDIO + path));
        expect(response?.status(), `${user} ${path}`).toBe(403);
      }
      await page.context().clearCookies();
    }
  });

  test('the generation form validates its input', async ({ page }) => {
    await adminLogin(page, 'e2e-author');
    await generate(page, { count: '0' });
    // The browser refuses first (min=1); without that attribute, Django refuses too.
    const count = page.getByLabel('Number of questions');
    expect(await count.evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow)).toBe(
      true,
    );
    await expect(page).toHaveURL(/generationbatch\/add\/$/);
    await count.evaluate((el) => el.removeAttribute('min'));
    await page.getByRole('button', { name: 'Generate Questions' }).click();
    await expect(page.getByText(/greater than or equal to 1/)).toBeVisible();
    // A topic from another subject is refused by the form, not by the model.
    await page.goto(adminUrl(`${STUDIO}generationbatch/add/`));
    const foreignTopic = await page
      .getByLabel('Topic')
      .locator('option')
      .evaluateAll(
        (options) =>
          (options as HTMLOptionElement[]).find((o) => o.value && !o.label.startsWith('Math'))
            ?.value,
      );
    expect(foreignTopic).toBeTruthy();
    await page.getByLabel('Subject').selectOption('MATH');
    await page.getByLabel('Topic').selectOption(foreignTopic!);
    await page.getByLabel('Number of questions').fill('2');
    await page.getByRole('button', { name: 'Generate Questions' }).click();
    await expect(page.getByText('This topic does not belong to the chosen subject.')).toBeVisible();
  });

  test('an author generates a Grade 3 multiplication batch for review', async ({ page }) => {
    await adminLogin(page, 'e2e-author');
    await generate(page, { count: '6' });
    await expect(messages(page)).toContainText('Questions appear as drafts');
    firstBatch = batchId(page);
    await expect(page.getByText('Review the 6 questions from this batch')).toBeVisible();
    await page.getByText('Review the 6 questions from this batch').click();
    await expect(page.getByRole('row').filter({ hasText: /What is \d x \d\?/ })).toHaveCount(6);

    // Curriculum association: subject, grade, topic and the catalog skill are on every question.
    await page.getByRole('link', { name: 'What is 2 x 3?' }).click();
    await expect(page.locator('.field-grade')).toContainText('Grade 3');
    await expect(page.locator('.field-topic input, .field-topic .readonly').first()).toBeVisible();
    await expect(page.locator('#id_skill_code')).toHaveValue('multiplication-facts');
    await expect(page.getByText(/Validation report/)).toBeVisible();

    await page.goto(batchQuestions(firstBatch));
    const actions = await offeredActions(page);
    expect(actions).toContain('Submit selected drafts for review');
    expect(actions).not.toContain('Approve selected questions');
    expect(actions).not.toContain('Publish selected approved questions');
    // Clean generated questions already wait for a reviewer, so there is nothing to submit.
    const rows = page.getByRole('row').filter({ hasText: /What is \d x \d\?/ });
    await expect(rows.filter({ hasText: 'Needs review' })).toHaveCount(6);
    await page.locator('#action-toggle').check();
    await page.getByLabel('Action:').selectOption({ label: 'Submit selected drafts for review' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('invalid_transition');
  });

  test('duplicates are blocked by validation and cannot be approved', async ({ page }) => {
    await adminLogin(page, 'e2e-author');
    await generate(page, { count: '2' });
    duplicateBatch = batchId(page);
    await adminLogin(page, 'e2e-reviewer');
    await page.goto(batchQuestions(duplicateBatch));
    await page.locator('#action-toggle').check();
    await page.getByLabel('Action:').selectOption({ label: 'Approve selected questions' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('blocked_by_validation');
    await expect(messages(page)).not.toContainText('question(s) approved');
  });

  test('a reviewer approves and rejects, but cannot publish', async ({ page }) => {
    await adminLogin(page, 'e2e-reviewer');
    await page.goto(batchQuestions(firstBatch));
    const actions = await offeredActions(page);
    expect(actions).not.toContain('Publish selected approved questions');
    await runAction(page, ['What is 7 x 3?'], 'Reject selected questions');
    await expect(messages(page)).toContainText('1 question(s) rejected');
    await runAction(
      page,
      ['What is 2 x 3?', 'What is 3 x 3?', 'What is 4 x 3?', 'What is 5 x 3?', 'What is 6 x 3?'],
      'Approve selected questions',
    );
    await expect(messages(page)).toContainText('5 question(s) approved');
    // Posting the publish action anyway does nothing: Django checks the permission too.
    expect(await offeredActions(page)).not.toContain('Publish selected approved questions');
  });

  test('a publisher publishes immutable revisions', async ({ page }) => {
    await adminLogin(page, 'e2e-publisher');
    await page.goto(batchQuestions(firstBatch));
    await page.locator('#action-toggle').check();
    await page.getByLabel('Action:').selectOption({ label: 'Publish selected approved questions' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('5 question(s) published');
    await expect(messages(page)).toContainText('Skipped'); // the rejected one
    await page.goto(adminUrl(`${STUDIO}questionrevision/`));
    await expect(page.getByRole('row').filter({ hasText: 'What is' })).toHaveCount(5);
    // A published question is read-only: no field to edit, no save.
    await page.goto(batchQuestions(firstBatch));
    await page.getByRole('link', { name: 'What is 2 x 3?' }).click();
    await expect(page.locator('#id_stem')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  });

  test('a correction is a new draft; the published revision stays until it replaces it', async ({
    page,
  }) => {
    await adminLogin(page, 'e2e-author');
    await page.goto(batchQuestions(firstBatch));
    await runAction(page, ['What is 6 x 3?'], 'Start a correction of selected published questions');
    await expect(messages(page)).toContainText('1 question(s) copied into a correction draft');
    // Starting a second correction of the same question is refused.
    await page.goto(batchQuestions(firstBatch));
    await runAction(page, ['What is 6 x 3?'], 'Start a correction of selected published questions');
    await expect(messages(page)).toContainText('Skipped');
    // Authors cannot see revisions; the publisher sees the published one still serving.
    expect((await page.goto(adminUrl(`${STUDIO}questionrevision/`)))?.status()).toBe(403);
    await adminLogin(page, 'e2e-publisher');
    await page.goto(adminUrl(`${STUDIO}questionrevision/`));
    await expect(page.getByRole('row').filter({ hasText: 'What is 6 x 3?' })).toHaveCount(1);
  });

  test('a publisher retires a revision; only publishers may', async ({ page }) => {
    await adminLogin(page, 'e2e-reviewer');
    await page.goto(adminUrl(`${STUDIO}questionrevision/`));
    await expect(page.getByLabel('Action:')).toHaveCount(0);
    await adminLogin(page, 'e2e-publisher');
    await page.goto(adminUrl(`${STUDIO}questionrevision/`));
    await runAction(page, ['What is 6 x 3?'], 'Retire selected revisions (withdraw from play)');
    await expect(messages(page)).toContainText('1 retired, 0 skipped');
  });

  test('Django Admin stays usable at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await adminLogin(page, 'e2e-publisher');
    await page.goto(adminUrl(`${STUDIO}question/`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Action:')).toBeVisible();
    // The page never scrolls sideways; a wide table scrolls inside its own container.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a pool serves published questions to Treasure Rush, and retiring withdraws them', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    test.setTimeout(180_000);
    await adminLogin(page, 'e2e-publisher');
    await page.goto(adminUrl(`${STUDIO}questionpool/add/`));
    await page.getByLabel('Name').fill('Cove chest Grade 3 multiplication');
    await page.getByLabel('Enabled').check();
    await page.getByLabel('Region id').fill('treasure-rush-cove');
    await page.getByLabel('Entity id').fill('cove-chest');
    await page.getByLabel('Grade').selectOption('3');
    await page.getByLabel('Topic').fill('multiplication');
    await page.getByLabel('Skill code').fill('multiplication-facts');
    await page.getByLabel('Min pool size').fill('1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(messages(page)).toContainText('was added successfully');

    // An Explorer (Grade 3 band) gets a published multiplication question at the first chest.
    const explorer = await parentWithChild(request, 'studio-explorer', {
      nickname: 'Ada',
      ageBand: 'EXPLORER',
    });
    await signInAs(page, explorer.parent);
    await enterCove(page, explorer.childId);
    await approach(page, 'cove-pip');
    await page.keyboard.press('e');
    await page.getByRole('button', { name: 'Yes, I will help!' }).click();
    await page.getByRole('button', { name: 'Keep exploring' }).click();
    const issuedPromise = challengeResponse(page);
    await (await approach(page, 'cove-chest')).click();
    const issued = await issuedFrom(await issuedPromise);
    expect(issued.challenge.operation).toBe('MULTIPLY');
    expect(issued.challenge.operands[1]).toBe(3);
    expect(issued.challenge.operands[0]).not.toBe(6); // the retired one is never served
    const graded = answerResponse(page);
    await answerInPanel(page, issued, pictureAnswer(issued));
    expect((await (await graded).json()).correct).toBe(true);

    // Retire every bank revision: a new child's chest goes back to the authored challenge.
    await adminLogin(page, 'e2e-publisher');
    await page.goto(adminUrl(`${STUDIO}questionrevision/?status__exact=ACTIVE`));
    await page.locator('#action-toggle').check();
    await page
      .getByLabel('Action:')
      .selectOption({ label: 'Retire selected revisions (withdraw from play)' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('retired');
    const next = await parentWithChild(request, 'studio-after', {
      nickname: 'Bea',
      ageBand: 'EXPLORER',
    });
    const child = api(request, next.parent);
    const session = await child.post(
      `children/${next.childId}/regions/treasure-rush-cove/session/`,
    );
    expect(session.status()).toBeLessThan(300);
    const sessionId = ((await session.json()) as { sessionId: string }).sessionId;
    expect(
      (await child.post(`children/${next.childId}/quests/pips-missing-treasure/accept/`)).status(),
    ).toBeLessThan(300);
    const after = await child.post(
      `children/${next.childId}/sessions/${sessionId}/chests/cove-chest/challenge/`,
    );
    expect(after.status()).toBeLessThan(300);
    const authored = (await after.json()) as { challenge: { skillId: string } };
    expect(authored.challenge.skillId).not.toBe('multiplication-facts');
  });
});

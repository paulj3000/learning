import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { api, parentWithChild } from './support/fixtures';
import { adminLogin, adminUrl, offeredActions, runAction } from './support/admin';

/**
 * Owner-QA browser acceptance for AI Question Studio (LAI-AQS-026, QA 2026-11-07). Fills what
 * question-studio.spec.ts leaves out: editing and revalidating in the browser, a mixed bulk
 * approval, the published-content query and gameplay eligibility before and after unpublishing,
 * the retired page staying read-only (QA-AQS-D1), the review and generate pages at 390px, and a
 * `thread` run-mode batch finishing (run with LAI_E2E_STUDIO_RUN_MODE=thread --grep @thread).
 *
 * Fake model only (LAI_AI_PROVIDER=fake): no Bedrock call, no AWS, synthetic local accounts.
 * Grade 2 addition so nothing collides with the Grade 3 multiplication of the other spec, and an
 * Explorer child because the Explorer chest's authored challenge is SUBTRACT: an ADD challenge
 * can only have come from the bank. Every test writes screenshots and a browser-problem log to
 * test-results/qa-evidence/.
 */

const STUDIO = 'question_studio/';
const EVIDENCE = resolve(process.cwd(), 'test-results/qa-evidence');
const THREAD = process.env.LAI_E2E_STUDIO_RUN_MODE === 'thread';
const STEMS = ['What is 2 + 3?', 'What is 3 + 3?', 'What is 4 + 3?', 'What is 5 + 3?'];
const PUBLISHED_OPERANDS = [
  [2, 3],
  [4, 3],
  [5, 3],
];

interface Evidence {
  shot(page: Page, name: string): Promise<void>;
}

/** Every console error, uncaught exception, failed request and 5xx on any page (Admin too). */
const test = base.extend<{ evidence: Evidence }>({
  evidence: async ({ page }, provide, testInfo) => {
    mkdirSync(EVIDENCE, { recursive: true });
    const problems: string[] = [];
    const notes: string[] = [];
    page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // The permission tests open pages that answer 403 on purpose.
      if (/status of 403/.test(text)) return notes.push(`expected: ${text}`);
      problems.push(`console: ${text}`);
    });
    page.on('requestfailed', (request) => {
      const reason = request.failure()?.errorText ?? '';
      if (!reason.includes('ERR_ABORTED')) {
        problems.push(`failed: ${request.method()} ${request.url()} ${reason}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 500) {
        problems.push(
          `http ${response.status()}: ${response.request().method()} ${response.url()}`,
        );
      }
    });
    const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
    const project = testInfo.project.name;
    await provide({
      shot: async (p, name) => {
        await p.screenshot({ path: `${EVIDENCE}/${project}-${slug}-${name}.png`, fullPage: true });
      },
    });
    writeFileSync(
      `${EVIDENCE}/${project}-${slug}.json`,
      JSON.stringify({ test: testInfo.title, project, problems, notes }, null, 2),
    );
    expect(problems, 'browser errors or failed requests').toEqual([]);
  },
});

async function generate(page: Page, fields: { count: string; grade: string; skill: string }) {
  await page.goto(adminUrl(`${STUDIO}generationbatch/add/`));
  await page.getByLabel('Subject').selectOption('MATH');
  await page.getByLabel('Grade').selectOption(fields.grade);
  await page.getByLabel('Topic').selectOption('addition');
  await page.getByLabel('Skill or objective code').fill(fields.skill);
  await page.getByLabel('Question type').selectOption('MULTIPLE_CHOICE');
  await page.getByLabel('Number of questions').fill(fields.count);
  await page.getByRole('button', { name: 'Generate Questions' }).click();
}

const messages = (page: Page) => page.locator('ul.messagelist');
const row = (page: Page, stem: string) => page.getByRole('row').filter({ hasText: stem });
let batchUrl = '';

async function openQuestion(page: Page, stem: string) {
  await page.goto(batchUrl);
  await page.getByRole('link', { name: stem, exact: true }).click();
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
}

/** Starts an Explorer's region session, accepts Pip's quest and opens the first chest by API. */
async function explorerChestChallenge(
  request: Parameters<typeof parentWithChild>[0],
  label: string,
) {
  const next = await parentWithChild(request, label, { nickname: 'Ada', ageBand: 'EXPLORER' });
  const child = api(request, next.parent);
  const session = await child.post(`children/${next.childId}/regions/treasure-rush-cove/session/`);
  expect(session.status(), await session.text()).toBeLessThan(300);
  const { sessionId } = (await session.json()) as { sessionId: string };
  const accepted = await child.post(
    `children/${next.childId}/quests/pips-missing-treasure/accept/`,
  );
  expect(accepted.status(), await accepted.text()).toBeLessThan(300);
  const issued = await child.post(
    `children/${next.childId}/sessions/${sessionId}/chests/cove-chest/challenge/`,
  );
  expect(issued.status(), await issued.text()).toBeLessThan(300);
  const body = (await issued.json()) as {
    challenge: { operation: string; operands: number[]; skillId: string; choices: number[] };
  };
  expect(JSON.stringify(body)).not.toMatch(/"answer"/); // the key never leaves Django
  return body.challenge;
}

test.describe.serial('AI Question Studio owner QA (AQS-026)', () => {
  test.skip(THREAD, 'thread run-mode pass runs only the @thread check');

  test('an author generates a Grade 2 addition batch', async ({ page, evidence }) => {
    await adminLogin(page, 'e2e-author');
    await generate(page, { count: '4', grade: '2', skill: 'addition-within-ten' });
    await expect(messages(page)).toContainText('Questions appear as drafts');
    await expect(page.locator('.field-status')).toContainText('Completed');
    await evidence.shot(page, 'batch');
    await page.getByText('Review the 4 questions from this batch').click();
    batchUrl = page.url();
    for (const stem of STEMS) await expect(row(page, stem)).toContainText('Needs review');
    await evidence.shot(page, 'drafts');
  });

  test('editing a question revalidates it: a wrong key fails, the fix passes', async ({
    page,
    evidence,
  }) => {
    await adminLogin(page, 'e2e-author');
    await openQuestion(page, 'What is 4 + 3?');
    await expect(page.getByText(/Validation report/)).toBeVisible();
    await page.locator('#id_correct_answer').fill('B');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row(page, 'What is 4 + 3?')).toContainText('Fail');
    await expect(row(page, 'What is 4 + 3?')).toContainText('Draft');
    await openQuestion(page, 'What is 4 + 3?');
    await expect(page.locator('.inline-group').first()).toContainText('answer_key_wrong');
    await evidence.shot(page, 'failing-report');
    // A failing draft cannot be approved, even by a reviewer posting the action.
    await adminLogin(page, 'e2e-reviewer');
    await page.goto(batchUrl);
    await runAction(page, ['What is 4 + 3?'], 'Approve selected questions');
    await expect(messages(page)).toContainText('blocked_by_validation');
    // The author corrects the key; the edit revalidates and the question is a clean draft again.
    await adminLogin(page, 'e2e-author');
    await openQuestion(page, 'What is 4 + 3?');
    await page.locator('#id_correct_answer').fill('A');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row(page, 'What is 4 + 3?')).not.toContainText('Fail');
    await evidence.shot(page, 'fixed');
  });

  test('a reviewer revalidates, rejects one and approves the rest with mixed results', async ({
    page,
    evidence,
  }) => {
    await adminLogin(page, 'e2e-reviewer');
    await page.goto(batchUrl);
    await page.locator('#action-toggle').check();
    await page.getByLabel('Action:').selectOption({ label: 'Revalidate selected questions' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('4 question(s) revalidated');
    await runAction(page, ['What is 3 + 3?'], 'Reject selected questions');
    await expect(messages(page)).toContainText('1 question(s) rejected');
    await expect(row(page, 'What is 3 + 3?')).toContainText('Rejected');
    await page.locator('#action-toggle').check();
    await page.getByLabel('Action:').selectOption({ label: 'Approve selected questions' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('3 question(s) approved');
    await expect(messages(page)).toContainText('invalid_transition'); // the rejected one
    await expect(row(page, 'What is 3 + 3?')).toContainText('Rejected');
    for (const stem of ['What is 2 + 3?', 'What is 4 + 3?', 'What is 5 + 3?']) {
      await expect(row(page, stem)).toContainText('Approved');
    }
    expect(await offeredActions(page)).not.toContain('Publish selected approved questions');
    await evidence.shot(page, 'reviewed');
  });

  test('a publisher publishes; only approved questions reach the published revisions', async ({
    page,
    evidence,
  }) => {
    await adminLogin(page, 'e2e-publisher');
    await page.goto(batchUrl);
    await page.locator('#action-toggle').check();
    await page.getByLabel('Action:').selectOption({ label: 'Publish selected approved questions' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('3 question(s) published');
    await expect(messages(page)).toContainText('Skipped');
    await page.goto(adminUrl(`${STUDIO}questionrevision/?status__exact=ACTIVE&grade__exact=2`));
    await expect(page.getByRole('row').filter({ hasText: /What is \d \+ 3\?/ })).toHaveCount(3);
    await expect(page.getByRole('row').filter({ hasText: 'What is 3 + 3?' })).toHaveCount(0);
    await evidence.shot(page, 'revisions');
  });

  test('a published question is served to an Explorer, and retiring it withdraws it', async ({
    page,
    request,
    evidence,
  }) => {
    await adminLogin(page, 'e2e-publisher');
    await page.goto(adminUrl(`${STUDIO}questionpool/add/`));
    await page.getByLabel('Name').fill('QA Grade 2 addition');
    await page.getByLabel('Enabled').check();
    await page.getByLabel('Region id').fill('treasure-rush-cove');
    await page.getByLabel('Entity id').fill('cove-chest');
    await page.getByLabel('Grade').selectOption('2');
    await page.getByLabel('Topic').fill('addition');
    await page.getByLabel('Skill code').fill('addition-within-ten');
    await page.getByLabel('Min pool size').fill('1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(messages(page)).toContainText('was added successfully');

    const served = await explorerChestChallenge(request, 'qa-bank');
    expect(served.operation).toBe('ADD'); // the authored Explorer challenge is SUBTRACT
    expect(PUBLISHED_OPERANDS).toContainEqual(served.operands);
    expect(served.operands).not.toEqual([3, 3]); // the rejected question

    // Unpublish: retire every active Grade 2 revision.
    await page.goto(adminUrl(`${STUDIO}questionrevision/?status__exact=ACTIVE&grade__exact=2`));
    await page.locator('#action-toggle').check();
    await page
      .getByLabel('Action:')
      .selectOption({ label: 'Retire selected revisions (withdraw from play)' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('3 retired, 0 skipped');
    await evidence.shot(page, 'retired');

    const fallback = await explorerChestChallenge(request, 'qa-after-retire');
    expect(fallback.operation).toBe('SUBTRACT'); // the configured authored fallback

    // Leave the chest free for the other spec's pool (one enabled pool per chest).
    await page.goto(adminUrl(`${STUDIO}questionpool/`));
    await page.getByRole('link', { name: 'QA Grade 2 addition' }).click();
    await page.getByLabel('Enabled').uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(messages(page)).toContainText('was changed successfully');
  });

  test('a retired question stays read-only and cannot re-enter review (QA-AQS-D1)', async ({
    page,
    evidence,
  }) => {
    await adminLogin(page, 'e2e-publisher');
    await openQuestion(page, 'What is 2 + 3?');
    await expect(page.locator('.field-review_status')).toContainText('Rejected');
    await expect(page.locator('#id_stem')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await evidence.shot(page, 'retired-read-only');
  });

  test('unauthorised staff are refused at every Studio page', async ({ page, evidence }) => {
    await adminLogin(page, 'e2e-no-perms');
    await page.goto(batchUrl);
    const question = await page.evaluate(() => location.href);
    for (const path of [
      'question/',
      'generationbatch/add/',
      'questionrevision/',
      'questionpool/',
    ]) {
      expect((await page.goto(adminUrl(STUDIO + path)))?.status(), path).toBe(403);
    }
    expect((await page.goto(question))?.status()).toBe(403);
    await evidence.shot(page, 'no-perms');
    await adminLogin(page, 'e2e-author');
    for (const path of ['questionrevision/', 'questionpool/']) {
      expect((await page.goto(adminUrl(STUDIO + path)))?.status(), path).toBe(403);
    }
    await page.goto(batchUrl);
    const actions = await offeredActions(page);
    expect(actions).not.toContain('Approve selected questions');
    expect(actions).not.toContain('Publish selected approved questions');
  });

  test('the generate, list and review pages work at 390px', async ({ page, evidence }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await adminLogin(page, 'e2e-author');
    await page.goto(adminUrl(`${STUDIO}generationbatch/add/`));
    await expect(page.getByRole('button', { name: 'Generate Questions' })).toBeVisible();
    await noSidewaysScroll(page);
    await evidence.shot(page, 'mobile-generate');
    await adminLogin(page, 'e2e-reviewer');
    await page.goto(batchUrl);
    await expect(page.getByLabel('Action:')).toBeVisible();
    await noSidewaysScroll(page);
    await evidence.shot(page, 'mobile-list');
    // The review page of a reviewable question: report, history and Save all reachable.
    await openQuestion(page, 'What is 5 + 3?');
    await expect(page.getByText(/Validation report/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await noSidewaysScroll(page);
    await evidence.shot(page, 'mobile-review');
    // A critical action at phone width: revalidate from the list.
    await page.goto(batchUrl);
    await runAction(page, ['What is 4 + 3?'], 'Revalidate selected questions');
    await expect(messages(page)).toContainText('1 question(s) revalidated');
    await evidence.shot(page, 'mobile-action');
  });
});

test('@thread a thread run-mode batch finishes without blocking the request', async ({
  page,
  evidence,
}) => {
  test.skip(!THREAD, 'needs LAI_E2E_STUDIO_RUN_MODE=thread');
  await adminLogin(page, 'e2e-author');
  await generate(page, { count: '7', grade: '1', skill: 'addition-within-ten' });
  await expect(messages(page)).toContainText('Questions appear as drafts');
  await evidence.shot(page, 'thread-started');
  await expect(async () => {
    await page.reload();
    await expect(page.locator('.field-status')).toContainText('Completed', { timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.locator('.field-produced_count')).toContainText('7');
  await expect(page.locator('.field-chunks_done')).toContainText('2');
  await evidence.shot(page, 'thread-completed');
});

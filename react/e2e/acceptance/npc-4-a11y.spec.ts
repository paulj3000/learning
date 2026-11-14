import { writeFileSync, mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { api, expect, parentWithChild, signInAs, test } from './support/fixtures';
import { enterCove, type E2EProbe } from './support/cove';
import { shot } from './support/npc';

/**
 * NPC Manager accessibility, sound preferences, reduced motion, cleanup and repeated-use
 * performance (docs/NPC_MANAGER_QA_REPORT.md, Phase 5). Runs after npc-1-admin.spec.ts
 * (NPC release 3 ACTIVE). axe-core scans the NPC UI (prompt and dialogue panel) and fails on
 * any WCAG 2.1 A/AA violation there; the whole page's results are written to
 * `test-results/npc-qa/axe-*.json` for the report without failing this suite, since the rest of
 * the page is outside the NPC Manager.
 *
 * Not covered here (physical devices, see the QA report): VoiceOver/TalkBack speech output,
 * switch access, real touch on a tablet, frame rate on the reference tablet.
 */

type Npc = ReturnType<E2EProbe['npcs']>[number];
const npcs = (page: Page): Promise<Npc[]> => page.evaluate(() => window.__laiE2E!.npcs());
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function readyPip(page: Page) {
  await expect
    .poll(async () => (await npcs(page)).filter((n) => n.visible && !n.placeholder).length, {
      timeout: 30_000,
    })
    .toBe(1);
  // Let an ambient first-visit greeting arrive (a non-modal bubble since F-B), then close it.
  await page.waitForTimeout(800);
  for (const open of [
    page.getByRole('dialog', { name: 'Pirate Pip' }),
    page.getByRole('region', { name: 'Pirate Pip' }),
  ]) {
    if (await open.count()) await open.getByRole('button', { name: 'Close' }).click();
    await expect(open).toHaveCount(0);
  }
}

async function openPip(page: Page) {
  await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 1.6));
  const prompt = page.getByRole('button', { name: 'Talk to Pirate Pip' });
  await expect(prompt).toBeVisible();
  await prompt.click();
  const dialog = page.getByRole('dialog', { name: 'Pirate Pip' });
  await expect(dialog).toContainText('Will you help me?');
  return { prompt, dialog };
}

function saveAxe(name: string, results: unknown) {
  mkdirSync('test-results/npc-qa', { recursive: true });
  writeFileSync(`test-results/npc-qa/axe-${name}.json`, JSON.stringify(results, null, 2));
}

test.describe('NPC Manager accessibility and comfort', () => {
  test('axe: the Talk prompt and the dialogue panel have no WCAG 2.1 AA violations', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const { parent, childId } = await parentWithChild(request, 'npc-axe', {
      nickname: 'Ada',
      ageBand: 'PATHFINDER',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    // The first-visit greeting bubble (F-B): no violations, 56 px targets, focus left alone.
    const greeting = page.getByRole('region', { name: 'Pirate Pip' });
    await expect(greeting).toBeVisible({ timeout: 30_000 });
    const bubbleScan = await new AxeBuilder({ page })
      .include('[data-npc-ambient]')
      .withTags(WCAG)
      .analyze();
    saveAxe('pip-ambient', bubbleScan);
    expect(bubbleScan.violations, JSON.stringify(bubbleScan.violations, null, 1)).toEqual([]);
    for (const name of ['Continue', 'Close']) {
      const box = (await greeting.getByRole('button', { name }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(56);
    }
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[data-npc-ambient]'))),
    ).toBe(false);
    await readyPip(page);
    await page.evaluate(() => window.__laiE2E!.standFacing('cove-pip', 1.6));
    const prompt = page.getByRole('button', { name: 'Talk to Pirate Pip' });
    await expect(prompt).toBeVisible();
    await prompt.evaluate((el) => el.setAttribute('data-qa-scan', 'npc-prompt'));
    const promptScan = await new AxeBuilder({ page })
      .include('[data-qa-scan="npc-prompt"]')
      .withTags(WCAG)
      .analyze();
    expect(promptScan.violations, JSON.stringify(promptScan.violations, null, 1)).toEqual([]);
    // Large targets for young children (docs/NPC_MANAGER_ACCESSIBILITY.md: 56 px).
    const promptBox = (await prompt.boundingBox())!;
    expect(promptBox.height).toBeGreaterThanOrEqual(56);

    await prompt.click();
    const dialog = page.getByRole('dialog', { name: 'Pirate Pip' });
    await expect(dialog).toContainText('Will you help me?');
    const panelScan = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(WCAG)
      .analyze();
    saveAxe('pip-dialog', panelScan);
    expect(panelScan.violations, JSON.stringify(panelScan.violations, null, 1)).toEqual([]);
    for (const name of ['Yes, I will help!', 'Maybe later', 'Close']) {
      const box = (await dialog.getByRole('button', { name }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(56);
    }

    // Whole page, recorded for the report (not failed here: outside the NPC Manager).
    saveAxe('cove-page', await new AxeBuilder({ page }).withTags(WCAG).analyze());
  });

  test('screen reader semantics: named modal dialog, one live line, labelled choices', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    const { parent, childId } = await parentWithChild(request, 'npc-sr', {
      nickname: 'Bo',
      ageBand: 'EXPLORER',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    await readyPip(page);
    const { dialog } = await openPip(page);
    expect(await dialog.getAttribute('aria-modal')).toBe('true');
    const live = dialog.locator('[aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toHaveAttribute('aria-atomic', 'true');
    await expect(live).toContainText('Will you help me?');
    await expect(dialog.getByRole('group', { name: 'What will you say?' })).toBeVisible();
    // The line is in the live region exactly once (never read twice).
    const text = await live.innerText();
    expect(text.split('Will you help me?').length - 1).toBe(1);
    // Focus starts inside the dialog.
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    );
    const snapshot = await dialog.ariaSnapshot();
    writeFileSync('test-results/npc-qa/aria-pip-dialog.txt', snapshot);
  });

  test('reduced motion: the panel has no transitions and the NPC still talks', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { parent, childId } = await parentWithChild(request, 'npc-motion', {
      nickname: 'Cy',
      ageBand: 'SPROUT',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    await readyPip(page);
    const { dialog } = await openPip(page);
    const moving = await dialog.evaluate(
      (root) =>
        [root, ...Array.from(root.querySelectorAll('*'))].filter((el) => {
          const style = getComputedStyle(el);
          const seconds = (value: string) =>
            Math.max(...value.split(',').map((part) => parseFloat(part) || 0));
          return (
            seconds(style.transitionDuration) > 0.01 || seconds(style.animationDuration) > 0.01
          );
        }).length,
    );
    expect(moving).toBe(0);
    await shot(page, 'a11y-01-reduced-motion-dialog');
  });

  test('muted: a voiced NPC shows captions only and asks for no speech', async ({
    page,
    request,
    problems,
  }) => {
    problems.allowConsole(/backpack/i);
    const { parent, childId } = await parentWithChild(request, 'npc-mute', {
      nickname: 'Dee',
      ageBand: 'PATHFINDER',
    });
    const settings = await api(request, parent).patch(`children/${childId}/audio/settings/`, {
      masterMuted: true,
    });
    expect(settings.status(), await settings.text()).toBeLessThan(300);
    const speech: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/') && r.url().includes('/audio/speech/')) speech.push(r.url());
    });
    await signInAs(page, parent);
    await page.goto(`/island/${childId}/explore/storykeeper-castle`);
    await expect
      .poll(async () => (await npcs(page).catch(() => [])).filter((n) => n.visible).length, {
        timeout: 30_000,
      })
      .toBe(1);
    await page.evaluate(() => window.__laiE2E!.standFacing('keeper-quill', 1.6));
    await page.getByRole('button', { name: 'Talk to Keeper Quill' }).click();
    const dialog = page.getByRole('dialog', { name: 'Keeper Quill' });
    await expect(dialog).toContainText('your ideas');
    await dialog.getByRole('button', { name: 'I have lots of ideas!' }).click();
    await expect(dialog).toContainText('Will you help me tell a brand new tale?');
    await expect(dialog.getByRole('button', { name: 'Hear it again' })).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(speech).toEqual([]);
    await shot(page, 'a11y-02-muted-captions-only');
  });

  test('repeated interaction and leaving: one NPC, listeners and memory settle', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    test.setTimeout(240_000);
    const { parent, childId } = await parentWithChild(request, 'npc-perf', {
      nickname: 'Eli',
      ageBand: 'PATHFINDER',
    });
    await signInAs(page, parent);
    await enterCove(page, childId);
    await readyPip(page);
    const cdp = await page.context().newCDPSession(page);
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize;
    };
    const modelFetches: string[] = [];
    page.on('request', (r) => {
      if (/npc-pip|asset-files/.test(r.url())) modelFetches.push(r.url());
    });

    const before = await heap();
    for (let i = 0; i < 20; i += 1) {
      const { dialog } = await openPip(page);
      await dialog.getByRole('button', { name: 'Maybe later' }).click();
      await expect(dialog).toHaveCount(0);
    }
    const afterTalks = await heap();
    expect((await npcs(page)).length).toBe(1);
    // The model is not fetched again while talking (cached, never per frame).
    expect(modelFetches).toEqual([]);

    // Leave through the app (client-side) and come back, five times.
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.getByRole('link', { name: 'Go back to the harbor' }).first().click();
      await expect(page).toHaveURL(new RegExp(`/island/${childId}$`));
      // The harbor map is its own scene: nothing of the cove's NPC runtime is left in it.
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__laiE2E?.npcs().filter((n) => n.npcId === 'pirate-pip').length ?? 0,
          ),
        )
        .toBe(0);
      await page.goBack();
      await expect
        .poll(() => page.evaluate(() => window.__laiE2E?.npcs().length ?? 0), {
          timeout: 30_000,
        })
        .toBe(1);
      samples.push(await heap());
    }
    // A frame-time sample under software WebGL (informational; the tablet budget is the owner's).
    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const times: number[] = [];
          let last = performance.now();
          const tick = (now: number) => {
            times.push(now - last);
            last = now;
            if (times.length < 120) requestAnimationFrame(tick);
            else resolve(times);
          };
          requestAnimationFrame(tick);
        }),
    );
    const sorted = [...frames].sort((a, b) => a - b);
    const result = {
      heapBeforeMB: before / 2 ** 20,
      heapAfter20TalksMB: afterTalks / 2 ** 20,
      heapAfterEachReentryMB: samples.map((s) => s / 2 ** 20),
      frameMsMedian: sorted[Math.floor(sorted.length / 2)],
      frameMsP95: sorted[Math.floor(sorted.length * 0.95)],
    };
    mkdirSync('test-results/npc-qa', { recursive: true });
    writeFileSync('test-results/npc-qa/perf.json', JSON.stringify(result, null, 2));
    // No steady growth: the last re-entry is within 15 MB of the first.
    expect(samples[samples.length - 1]! - samples[0]!).toBeLessThan(15 * 2 ** 20);
    expect(afterTalks - before).toBeLessThan(10 * 2 ** 20);
  });
});

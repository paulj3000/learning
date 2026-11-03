import { api, expect, parentWithChild, signInAs, test } from './support/fixtures';
import { approach, covePath, enterCove } from './support/cove';

/**
 * Cross-feature checks that are not owned by one suite: child isolation under Cognito tokens
 * (F) and the rest of the island still working beside Treasure Rush (G). The Studio-to-play
 * (A, B) and asset delivery (C, D, E) paths are in question-studio and asset-library specs.
 */

test('a parent cannot reach another family’s child, through the API or the app', async ({
  page,
  request,
  problems,
}) => {
  const a = await parentWithChild(request, 'iso-a', { nickname: 'Ana', ageBand: 'PATHFINDER' });
  const b = await parentWithChild(request, 'iso-b', { nickname: 'Ben', ageBand: 'PATHFINDER' });
  const asB = api(request, b.parent);
  for (const path of [
    `children/${a.childId}/`,
    `children/${a.childId}/progress/`,
    `children/${a.childId}/regions/treasure-rush-cove/`,
    `children/${a.childId}/assets/?ids=barrel`,
  ]) {
    expect([403, 404], path).toContain((await asB.get(path)).status());
  }
  expect([403, 404]).toContain(
    (await asB.post(`children/${a.childId}/regions/treasure-rush-cove/session/`)).status(),
  );
  expect([403, 404]).toContain(
    (await asB.patch(`children/${a.childId}/`, { nickname: 'X' })).status(),
  );
  // A's child is untouched and still A's alone.
  const own = await api(request, a.parent).get(`children/${a.childId}/`);
  expect(own.status()).toBe(200);
  expect(((await own.json()) as { nickname: string }).nickname).toBe('Ana');
  // B's own list never shows A's child.
  const list = (await (await asB.get('children/')).json()) as { children: { id: string }[] };
  expect(list.children.map((child) => child.id)).toEqual([b.childId]);
  // No token at all: 401.
  expect((await request.get(`${new URL(await own.url())?.origin}/api/v1/children/`)).status()).toBe(
    401,
  );

  // In the browser, B opening A's cove gets the calm refusal and no play data.
  problems.allowStatus(new RegExp(`/children/${a.childId}/`), 404);
  problems.allowStatus(new RegExp(`/children/${a.childId}/`), 403);
  problems.allowConsole(/Failed to load resource: the server responded with a status of 40[34]/);
  await signInAs(page, b.parent);
  await page.goto(covePath(a.childId));
  await expect(
    page.getByText(/isn't open yet|not open for you|went wrong loading this part/i).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hint' })).toHaveCount(0);
});

/*
 * The harbor map, adventure log and the Amplify-session places read Amplify Data (companion,
 * world changes), which this offline harness does not provide (docs/TREASURE_RUSH_LOCAL_DEV.md:
 * "the Amplify-backed extras ... do not know a Django child"). This branch does not change
 * them; they are left to the Amplify sandbox check recorded in IMPLEMENTATION_STATUS.md.
 */
test('beside Treasure Rush: the dashboard and an adventure launched from the cove', async ({
  page,
  request,
  problems,
}) => {
  void problems;
  const { parent, childId } = await parentWithChild(request, 'island', {
    nickname: 'Ivy',
    ageBand: 'PATHFINDER',
  });
  await signInAs(page, parent);
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1, name: "Ivy's dashboard" })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Island places' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enter island' })).toHaveAttribute(
    'href',
    `/island/${childId}`,
  );

  // An adventure begun from the cove's signpost (ADR-041) leaves the cove for the adventure.
  await enterCove(page, childId);
  await (await approach(page, 'cove-bridge-signpost', 'Bridge signpost')).click();
  const launch = page.getByRole('dialog').getByRole('button').first();
  await expect(launch).toBeVisible();
  const started = page.waitForResponse(
    (r) => r.url().includes('/launch') && r.request().method() === 'POST',
  );
  await launch.click();
  expect((await started).status()).toBeLessThan(300);
  await expect(page).not.toHaveURL(new RegExp(covePath(childId)));
});

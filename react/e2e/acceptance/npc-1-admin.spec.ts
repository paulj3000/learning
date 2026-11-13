import { adminLogin, adminUrl } from './support/admin';
import { api, expect, mintParent, parentWithChild, test } from './support/fixtures';
import { characterGlb, MIXAMO_CLIPS } from './support/glb';
import {
  areaNpcs,
  catalogIds,
  choose,
  defineCharacterAsset,
  errors,
  field,
  messages,
  placeNpcs,
  placedIds,
  save,
  shot,
  uploadVersion,
  type RuntimeRead,
} from './support/npc';

/**
 * NPC Manager: Django Admin browser QA (docs/NPC_MANAGER_QA_REPORT.md, Phase 2 and 3).
 *
 * Staff author a brand new character end to end in a real browser against the disposable e2e
 * Django and PostgreSQL: a GLB upload, the variant and its animation map, a behaviour profile, a
 * placement, a dialogue with nodes and choices; then validate, publish, roll back and retire,
 * and check what the child runtime API serves at each step. Pip and Quill start as unpublished
 * drafts (tests/e2e/django_server.py), so the first publish here is NPC release 1 and carries all
 * three characters. Nothing reaches AWS (fake AI and speech, in-memory asset storage).
 *
 * The suite leaves one ACTIVE release (release 3, see the last test) for the Treasure Rush and
 * Storykeeper's Castle specs that follow.
 */

const NPC = 'e2e-lantern-keeper';
const NAME = 'Lantern Keeper';
const MODEL = 'e2e-lantern-model';
const MIXAMO = 'e2e-mixamo-model';
const PLACE = 'fossil-ridge-camp';
const GREETING = 'Hello, explorer! My lantern shows the way.';
const DRAFT_GREETING = 'This draft line must never reach a child.';

test.describe.serial('NPC Manager in Django Admin', () => {
  test('staff without NPC rights are refused; editors cannot publish', async ({ page }) => {
    for (const username of ['e2e-no-perms', 'e2e-author']) {
      await adminLogin(page, username);
      for (const path of ['npcs/npccharacter/', 'npcs/npcrelease/validate/']) {
        expect((await page.goto(adminUrl(path)))?.status(), `${username} ${path}`).toBe(403);
      }
    }
    await adminLogin(page, 'e2e-npc-editor');
    await page.goto(adminUrl('npcs/npccharacter/'));
    await expect(page.getByRole('link', { name: 'pirate-pip' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'keeper-quill' })).toBeVisible();
    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await expect(page.getByRole('button', { name: 'Publish a new release' })).toHaveCount(0);
    await shot(page, 'admin-01-validate-as-editor');
  });

  test('a character GLB uploads; Mixamo take names are kept verbatim and flagged', async ({
    page,
  }) => {
    await adminLogin(page, 'e2e-npc-editor');
    await defineCharacterAsset(page, MODEL);
    await uploadVersion(page, MODEL, 'lantern.glb', characterGlb(['Idle', 'Talk', 'Wave']));
    await expect(messages(page)).toContainText(`Uploaded ${MODEL} version 1`);

    await defineCharacterAsset(page, MIXAMO);
    await uploadVersion(page, MIXAMO, 'pirate-mixamo.glb', characterGlb(MIXAMO_CLIPS));
    await expect(messages(page)).toContainText(`Uploaded ${MIXAMO} version 1`);
    // The version page lists the clips exactly as the file names them, with a warning that the
    // game cannot play them by name. Nothing guesses which take is Idle or Walk.
    await page.goto(adminUrl(`assets/assetversion/?q=${MIXAMO}`));
    await page
      .getByRole('link', { name: new RegExp(MIXAMO) })
      .first()
      .click();
    const body = page.locator('#content');
    for (const clip of MIXAMO_CLIPS) await expect(body).toContainText(clip);
    await expect(body).toContainText(/not in the clip vocabulary/);
    // QA: a default take name is called out with the fix (rename in Blender, export again).
    await expect(body).toContainText(/exporter's default take name/);
    await expect(body).toContainText(/Rename each action in Blender/);
    await shot(page, 'admin-02-mixamo-version-findings');

    await adminLogin(page, 'e2e-npc-publisher');
    await page.goto(adminUrl('assets/assetversion/'));
    for (const id of [MODEL, MIXAMO]) {
      await page.getByRole('row').filter({ hasText: id }).first().getByRole('checkbox').check();
    }
    await page.getByLabel('Action:').selectOption({ label: 'Publish selected versions' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText('Published 2 version(s).');
  });

  test('an editor creates a Django-only character', async ({ page }) => {
    await adminLogin(page, 'e2e-npc-editor');
    await page.goto(adminUrl('npcs/npccharacter/add/'));
    // Neither an existing definition nor a new id: refused.
    await save(page);
    await expect(page.locator('.errorlist, .errornote').first()).toBeVisible();
    await field(page, 'new_npc_id').fill(NPC);
    await field(page, 'new_display_name').fill(NAME);
    await choose(page, 'new_home_place', 'fossil-ridge-camp');
    await field(page, 'role').selectOption('GUIDE');
    await field(page, 'status').selectOption('DRAFT');
    await field(page, 'dialogue_mode').selectOption('AUTHORED');
    await field(page, 'personality').fill(
      '{"traits": ["calm", "kind"], "tone": "gentle", "catchphrases": ["Follow the light!"]}',
    );
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was added successfully');
    await shot(page, 'admin-03-character-created');
    await page.goto(adminUrl(`npcs/npccharacter/?q=${NPC}`));
    await expect(page.getByRole('row').filter({ hasText: NPC })).toContainText(
      /Created in Django|DJANGO/i,
    );
  });

  test('variant animation maps are checked against the model clips', async ({ page }) => {
    await adminLogin(page, 'e2e-npc-editor');
    const attempt = async (model: string, map: string) => {
      await page.goto(adminUrl('npcs/npcmodelvariant/add/'));
      await choose(page, 'character', NPC);
      await field(page, 'variant_key').fill('lantern');
      await field(page, 'display_name').fill('Lantern Keeper');
      await field(page, 'is_default').check();
      await choose(page, 'model_asset', model);
      await field(page, 'animation_map').fill(map);
      await save(page, true);
    };
    // A clip the model does not have: refused, naming the clips it does have.
    await attempt(MODEL, '{"idle": "Idle", "walk": "Walking"}');
    await expect(page.locator('.errorlist')).toContainText('Walking');
    await expect(page.locator('.errorlist')).toContainText(/Idle.*Talk.*Wave/);
    // An unknown runtime state: refused.
    await attempt(MODEL, '{"dance": "Idle"}');
    await expect(page.locator('.errorlist')).toContainText(/dance/);
    // Not a JSON object: refused.
    await attempt(MODEL, '["Idle"]');
    await expect(page.locator('.errorlist').first()).toBeVisible();
    // The ambiguous Mixamo model: semantic names are refused because the file has none, and the
    // refusal lists the real take names so staff can see what the export produced.
    await attempt(MIXAMO, '{"idle": "Idle", "talk": "Talk"}');
    await expect(page.locator('.errorlist')).toContainText('Armature|mixamo.com|Layer0');
    await shot(page, 'admin-04-mixamo-map-refused');
    // Valid: every state maps to a clip the model has; optional states (walk, celebrate) are
    // simply left out and fall back at runtime.
    await attempt(MODEL, '{"idle": "Idle", "talk": "Talk", "wave": "Wave"}');
    await expect(messages(page), await errors(page)).toContainText('was added successfully');
    await expect(page.locator('#content')).toContainText(/Idle, Talk, Wave/);
    await shot(page, 'admin-05-variant-saved');
  });

  test('a behaviour profile validates its parameters and previews', async ({ page }) => {
    await adminLogin(page, 'e2e-npc-editor');
    await page.goto(adminUrl('npcs/npcbehaviorprofile/add/'));
    await field(page, 'key').fill('e2e-lantern-patrol');
    await field(page, 'display_name').fill('Lantern patrol');
    await field(page, 'behavior_type').selectOption('patrol');
    await field(page, 'parameters').fill('{"speed": 1}');
    await save(page, true);
    await expect(page.locator('.errorlist').first()).toBeVisible();
    // A waypoint outside the bounds radius is a geometry problem.
    await field(page, 'parameters').fill(
      '{"speed": 1, "boundsRadius": 2, "waypoints": [{"x": 0, "z": 0}, {"x": 9, "z": 0}]}',
    );
    await save(page, true);
    await expect(page.locator('.errorlist').first()).toBeVisible();
    await field(page, 'parameters').fill(
      '{"speed": 1, "boundsRadius": 6, "waypoints": [{"x": 0, "z": 0, "pauseSeconds": 2}, {"x": 3, "z": 1}]}',
    );
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was added successfully');
    await page
      .getByRole('link', { name: /preview/i })
      .first()
      .click();
    await expect(page.locator('svg').first()).toBeVisible();
    await shot(page, 'admin-06-behavior-preview');
  });

  test('a placement is validated against Island, Place and 3D Area', async ({ page }) => {
    await adminLogin(page, 'e2e-npc-editor');
    await page.goto(adminUrl('npcs/npcplacement/add/'));
    await field(page, 'placement_key').fill('fossil-lantern');
    await choose(page, 'character', NPC);
    await field(page, 'active').check();
    await choose(page, 'world', 'learning-adventure-island');
    // A Place on another Island is refused.
    await choose(page, 'location', 'lantern-tide-pools');
    await field(page, 'x').fill('2');
    await field(page, 'z').fill('-1.5');
    await field(page, 'rotation_y').fill('1.57');
    await field(page, 'interaction_radius').fill('2.5');
    await save(page, true);
    await expect(page.locator('.errorlist').first()).toBeVisible();
    await choose(page, 'location', 'fossil-ridge-camp');
    await choose(page, 'variant', 'lantern');
    await choose(page, 'behavior', 'e2e-lantern-patrol');
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was added successfully');
    await shot(page, 'admin-07-placement-saved');
  });

  test('a dialogue with nodes and choices', async ({ page }) => {
    await adminLogin(page, 'e2e-npc-editor');
    await page.goto(adminUrl('npcs/npcdialogue/add/'));
    await choose(page, 'character', NPC);
    await field(page, 'dialogue_key').fill('lantern-hello');
    await field(page, 'title').fill('Lantern hello');
    await field(page, 'trigger').selectOption('on_interact');
    await field(page, 'active').check();
    await page.getByRole('button', { name: 'Add another NPC dialogue node' }).click();
    await page.getByRole('button', { name: 'Add another NPC dialogue node' }).click();
    await field(page, 'nodes-0-node_key').fill('hello');
    await field(page, 'nodes-0-text').fill(GREETING);
    await field(page, 'nodes-1-node_key').fill('bye');
    await field(page, 'nodes-1-text').fill('Come back when it gets dark!');
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was added successfully');
    await choose(page, 'start_node', /:hello$/);
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was changed successfully');

    // Choices live on the node page.
    await page.goto(adminUrl('npcs/npcdialoguenode/?q=lantern-hello'));
    await page.getByRole('link', { name: /lantern-hello:hello/ }).click();
    await page.getByRole('button', { name: 'Add another NPC dialogue choice' }).click();
    await page.getByRole('button', { name: 'Add another NPC dialogue choice' }).click();
    await field(page, 'choices-0-choice_key').fill('more');
    await field(page, 'choices-0-label').fill('Tell me more');
    await choose(page, 'choices-0-next_node', /:bye$/);
    await field(page, 'choices-0-action').selectOption('NONE');
    await field(page, 'choices-0-sort_order').fill('0');
    await field(page, 'choices-1-choice_key').fill('later');
    await field(page, 'choices-1-label').fill('Maybe later');
    await field(page, 'choices-1-action').selectOption('END');
    // QA-D1: staff set the order a child sees; "later" sorts before "more" by key.
    await field(page, 'choices-1-sort_order').fill('1');
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was changed successfully');
    await shot(page, 'admin-08-dialogue-node-choices');
  });

  test('validate and publish: a DRAFT character is left out, a READY one is published', async ({
    page,
    request,
  }) => {
    await adminLogin(page, 'e2e-npc-publisher');
    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await shot(page, 'admin-09-validate-before-ready');
    // Only READY characters count: Pip and Quill, not the DRAFT Lantern Keeper.
    await expect(page.locator('#content')).toContainText('Draft: 2 character(s), 2 placement(s)');

    // Mark the new character READY.
    await page.goto(adminUrl(`npcs/npccharacter/?q=${NPC}`));
    await page.getByRole('link', { name: NPC }).click();
    await field(page, 'status').selectOption('READY');
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was changed successfully');

    // A broken dialogue (its start node cleared) is listed as a problem and cannot be published.
    await page.goto(adminUrl('npcs/npcdialogue/?q=lantern-hello'));
    await page
      .getByRole('link', { name: /lantern-hello/ })
      .first()
      .click();
    await field(page, 'start_node').selectOption('');
    await save(page, true);
    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await expect(page.locator('#content')).toContainText(/lantern-hello/);
    await expect(page.getByRole('heading', { name: /problem/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish a new release' })).toHaveCount(0);
    await shot(page, 'admin-09b-validate-refuses-broken-dialogue');
    await page.goto(adminUrl('npcs/npcdialogue/?q=lantern-hello'));
    await page
      .getByRole('link', { name: /lantern-hello/ })
      .first()
      .click();
    await choose(page, 'start_node', /:hello$/);
    await save(page, true);

    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await expect(page.locator('#content')).toContainText('Draft: 3 character(s), 3 placement(s)');
    await expect(page.locator('#content')).toContainText('Ready: no problems found.');
    await field(page, 'notes').fill('E2E QA release with the Lantern Keeper');
    await page.getByRole('button', { name: 'Publish a new release' }).click();
    await expect(messages(page), await errors(page)).toContainText('Published NPC release 1');
    await shot(page, 'admin-10-published-release-1');

    const { parent, childId } = await parentWithChild(request, 'npc-admin', {
      nickname: 'Lumi',
      ageBand: 'PATHFINDER',
    });
    const place = await placeNpcs(request, parent, childId, PLACE);
    expect(place.status(), await place.text()).toBe(200);
    const placed = (await place.json()) as RuntimeRead;
    expect(placed.release).toBe(1);
    expect(placedIds(placed)).toEqual([NPC]);
    const lantern = (placed.characters as Record<string, Record<string, unknown>>)[NPC];
    expect(JSON.stringify(lantern)).toContain(MODEL);
    // Server-only keys never reach the child (contract 5.1).
    for (const key of ['dialogues', 'persona', 'spawnConditions', 'availability', 'isDefault']) {
      expect(JSON.stringify(placed)).not.toContain(`"${key}"`);
    }
    const cove = (await (
      await areaNpcs(request, parent, childId, 'treasure-rush-cove')
    ).json()) as RuntimeRead;
    expect(placedIds(cove)).toEqual(['pirate-pip']);
    const castle = (await (
      await placeNpcs(request, parent, childId, 'storykeeper-castle')
    ).json()) as RuntimeRead;
    expect(placedIds(castle)).toEqual(['keeper-quill']);
    const catalog = (await (
      await api(request, parent).get(`children/${childId}/npcs/`)
    ).json()) as RuntimeRead;
    expect(catalogIds(catalog).sort()).toEqual(['keeper-quill', NPC, 'pirate-pip'].sort());

    // The authored conversation through the child API.
    const start = await api(request, parent).post(
      `children/${childId}/places/${PLACE}/npcs/${NPC}/interactions/`,
      { trigger: 'on_interact' },
    );
    expect(start.status(), await start.text()).toBe(200);
    const opened = (await start.json()) as {
      conversationId: string;
      node: { text: string };
      choices: { choiceKey: string }[];
    };
    expect(opened.node.text).toBe(GREETING);
    expect(opened.choices.map((c) => c.choiceKey)).toEqual(['more', 'later']);
  });

  test('drafts, unpublished versions and retired characters never reach a child', async ({
    page,
    request,
  }) => {
    const { parent, childId } = await parentWithChild(request, 'npc-drafts', {
      nickname: 'Ori',
      ageBand: 'EXPLORER',
    });
    const talk = async () => {
      const response = await api(request, parent).post(
        `children/${childId}/places/${PLACE}/npcs/${NPC}/interactions/`,
        { trigger: 'on_interact' },
      );
      return response;
    };
    await adminLogin(page, 'e2e-npc-editor');
    // A draft edit to the greeting.
    await page.goto(adminUrl('npcs/npcdialoguenode/?q=lantern-hello'));
    await page.getByRole('link', { name: /lantern-hello:hello/ }).click();
    await field(page, 'text').fill(DRAFT_GREETING);
    await save(page, true);
    await expect(messages(page)).toContainText('was changed successfully');
    // An unpublished second model version.
    await uploadVersion(page, MODEL, 'lantern-v2.glb', characterGlb(['Idle', 'Talk']));
    await expect(messages(page)).toContainText(`Uploaded ${MODEL} version 2`);

    const served = await talk();
    expect(((await served.json()) as { node: { text: string } }).node.text).toBe(GREETING);
    const read = (await (await placeNpcs(request, parent, childId, PLACE)).json()) as RuntimeRead;
    expect(read.release).toBe(1);
    expect(JSON.stringify(read)).toMatch(
      new RegExp(`"assetId":\\s*"${MODEL}"[^}]*"version":\\s*1`),
    );

    // Restore the line, retire the character, publish: release 2 has no Lantern Keeper.
    await page.goto(adminUrl('npcs/npcdialoguenode/?q=lantern-hello'));
    await page.getByRole('link', { name: /lantern-hello:hello/ }).click();
    await field(page, 'text').fill(GREETING);
    await save(page, true);
    await page.goto(adminUrl(`npcs/npccharacter/?q=${NPC}`));
    await page.getByRole('link', { name: NPC }).click();
    await field(page, 'status').selectOption('RETIRED');
    await save(page, true);
    await expect(messages(page), await errors(page)).toContainText('was changed successfully');

    await adminLogin(page, 'e2e-npc-publisher');
    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await field(page, 'notes').fill('Retire the Lantern Keeper');
    await page.getByRole('button', { name: 'Publish a new release' }).click();
    await expect(messages(page), await errors(page)).toContainText('Published NPC release 2');

    const after = (await (await placeNpcs(request, parent, childId, PLACE)).json()) as RuntimeRead;
    expect(after.release).toBe(2);
    expect(placedIds(after)).toEqual([]);
    expect((await talk()).status()).toBe(404);
  });

  test('rollback, retirement and asset dependency protection', async ({ page, request }) => {
    const { parent, childId } = await parentWithChild(request, 'npc-rollback', {
      nickname: 'Pell',
      ageBand: 'PATHFINDER',
    });
    await adminLogin(page, 'e2e-npc-publisher');
    await page.goto(adminUrl('npcs/npcrelease/'));
    await shot(page, 'admin-11-release-list');
    await page
      .getByRole('link', { name: /^(NPC release )?1\b/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Roll back to this release/ }).click();
    const confirm = page.getByRole('button', { name: /Yes|Confirm|Roll back/ });
    if (await confirm.count()) await confirm.first().click();
    await expect(messages(page), await errors(page)).toContainText('NPC release 1 rolled back');
    const rolled = (await (await placeNpcs(request, parent, childId, PLACE)).json()) as RuntimeRead;
    expect(rolled.release).toBe(1);
    expect(placedIds(rolled)).toEqual([NPC]);

    // The model that release 1 depends on cannot be retired.
    await page.goto(adminUrl('npcs/npcrelease/dependencies/'));
    await expect(page.locator('#content')).toContainText(MODEL);
    await expect(page.locator('#content')).toContainText('npc-pip');
    await shot(page, 'admin-12-dependencies');
    await page.goto(adminUrl(`catalog/contentasset/?q=${MODEL}`));
    await page.getByRole('row').filter({ hasText: MODEL }).first().getByRole('checkbox').check();
    await page.getByLabel('Action:').selectOption({ label: 'Retire selected assets' });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toContainText(/used by NPC release\(s\) 1 \(active\)/);
    await shot(page, 'admin-13-asset-retire-refused');

    // Retire the active release: children see no NPCs, and a retired release never comes back.
    await page.goto(adminUrl('npcs/npcrelease/'));
    await page
      .getByRole('link', { name: /^(NPC release )?1\b/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Retire this release/ }).click();
    const confirmRetire = page.getByRole('button', { name: /Yes|Confirm|Retire/ });
    if (await confirmRetire.count()) await confirmRetire.first().click();
    await expect(messages(page), await errors(page)).toContainText(/children see no NPCs/);
    // Nothing published is a normal empty answer, not a 404 (QA F-A).
    const none = await placeNpcs(request, parent, childId, PLACE);
    expect(none.status()).toBe(200);
    const empty = (await none.json()) as { release: number; placements: unknown[] };
    expect(empty.release).toBe(0);
    expect(empty.placements).toEqual([]);
    await page.goto(adminUrl('npcs/npcrelease/'));
    await page
      .getByRole('link', { name: /^(NPC release )?1\b/ })
      .first()
      .click();
    await expect(page.getByRole('button', { name: /Roll back to this release/ })).toHaveCount(0);

    // Release 3 for the specs that follow: Pip and Quill (the Lantern Keeper stays retired).
    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await field(page, 'notes').fill('QA release for Treasure Rush and the castle');
    await page.getByRole('button', { name: 'Publish a new release' }).click();
    await expect(messages(page), await errors(page)).toContainText('Published NPC release 3');
  });

  test('child ownership: another family, no token and the game cookie scope', async ({
    request,
  }) => {
    const { childId } = await parentWithChild(request, 'npc-owner', {
      nickname: 'Tam',
      ageBand: 'PATHFINDER',
    });
    const stranger = mintParent('npc-stranger');
    expect((await api(request, stranger).post('me/')).status()).toBeLessThan(300);
    for (const path of [
      `children/${childId}/npcs/`,
      `children/${childId}/regions/treasure-rush-cove/npcs/`,
      `children/${childId}/places/storykeeper-castle/npcs/`,
    ]) {
      expect((await api(request, stranger).get(path)).status(), path).toBe(404);
      const anonymous = await request.get(`${new URL(adminUrl()).origin}/api/v1/${path}`);
      expect(anonymous.status(), path).toBe(401);
    }
    const talk = await api(request, stranger).post(
      `children/${childId}/regions/treasure-rush-cove/npcs/pirate-pip/interactions/`,
      { trigger: 'on_interact' },
    );
    expect(talk.status()).toBe(404);
  });

  test('essential admin pages at mobile width @tablet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await adminLogin(page, 'e2e-npc-publisher');
    for (const [path, name] of [
      ['npcs/npccharacter/', 'admin-m1-characters'],
      ['npcs/npccharacter/1/change/', 'admin-m2-pip'],
      ['npcs/npcmodelvariant/1/change/', 'admin-m3-variant'],
      ['npcs/npcrelease/validate/', 'admin-m4-validate'],
      ['npcs/npcrelease/', 'admin-m5-releases'],
    ] as const) {
      expect((await page.goto(adminUrl(path)))?.status(), path).toBe(200);
      // The page never needs a sideways scroll to reach its main form or table.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
      await shot(page, name);
    }
    // Release 3 already holds the draft, so nothing is offered for publishing.
    await page.goto(adminUrl('npcs/npcrelease/validate/'));
    await expect(page.locator('#content')).toContainText('Unchanged:');
    await expect(page.getByRole('button', { name: 'Publish a new release' })).toHaveCount(0);
  });
});

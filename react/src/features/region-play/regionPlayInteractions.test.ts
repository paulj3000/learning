import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { bootstrapJson, questJson } from '../../test/playFixtures';
import { buildRegionManifest } from './regionManifest';
import { tryParseRegionPlayConfig } from './regionPlayConfig';
import {
  chestStateChanges,
  claimsRegionPlayInteraction,
  resolveRegionPlayInteraction,
} from './regionPlayInteractions';
import { toRegionSceneModel } from './sceneModel';

function setup(overrides: Record<string, unknown> = {}, chest: Record<string, unknown> = {}) {
  const bootstrap = read(bootstrapJson(overrides, chest), parse.regionBootstrap);
  const { manifest } = buildRegionManifest(toRegionSceneModel(bootstrap), {
    worldSlug: 'learning-adventure-island',
  });
  const config = tryParseRegionPlayConfig(manifest.extensions[0].config);
  if (!config) throw new Error('config did not parse');
  return { bootstrap, config };
}

const CHEST = 'treasure-rush-cove:chest:cove-chest';
const PIP = 'treasure-rush-cove:talk:cove-pip';

describe('resolveRegionPlayInteraction', () => {
  it('turns Pip into a conversation carrying the quests the server offers', () => {
    const { bootstrap, config } = setup({
      quests: [questJson(), questJson({ questId: 'someone-elses', giverNpcId: 'keeper-quill' })],
    });
    const event = resolveRegionPlayInteraction(config, bootstrap, PIP, false);
    expect(event).toMatchObject({
      kind: 'npc',
      entityId: 'cove-pip',
      npcId: 'pirate-pip',
      label: 'Pirate Pip',
    });
    expect(event?.kind === 'npc' && event.quests.map((q) => q.questId)).toEqual([
      'treasure-rush-cove',
    ]);
  });

  it('lets the child ask for a challenge only in a session, for a closed chest with one available', () => {
    const { bootstrap, config } = setup();
    expect(resolveRegionPlayInteraction(config, bootstrap, CHEST, true)).toMatchObject({
      kind: 'chest',
      isOpen: false,
      challengeAvailable: true,
      canRequestChallenge: true,
    });
    expect(resolveRegionPlayInteraction(config, bootstrap, CHEST, false)).toMatchObject({
      canRequestChallenge: false,
    });
    const open = setup({}, { isOpen: true });
    expect(resolveRegionPlayInteraction(open.config, open.bootstrap, CHEST, true)).toMatchObject({
      isOpen: true,
      canRequestChallenge: false,
    });
    const notForBand = setup({}, { challengeAvailable: false });
    expect(
      resolveRegionPlayInteraction(notForBand.config, notForBand.bootstrap, CHEST, true),
    ).toMatchObject({
      canRequestChallenge: false,
    });
  });

  it('knows nothing about interactions it did not bind', () => {
    const { bootstrap, config } = setup();
    expect(resolveRegionPlayInteraction(config, bootstrap, 'someone-else:thing', true)).toBeNull();
    expect(claimsRegionPlayInteraction(config, CHEST)).toBe(true);
    expect(claimsRegionPlayInteraction(config, 'someone-else:thing')).toBe(false);
    expect(claimsRegionPlayInteraction(null, CHEST)).toBe(false);
  });

  it('resolves against the server’s current state, so a chest opened since the build reads open', () => {
    const { config } = setup();
    const later = read(bootstrapJson({}, { isOpen: true }), parse.regionBootstrap);
    expect(resolveRegionPlayInteraction(config, later, CHEST, true)).toMatchObject({
      isOpen: true,
    });
  });
});

describe('chestStateChanges', () => {
  it('lists only the chests drawn differently from the server', () => {
    const chests = read(bootstrapJson({}, { isOpen: true }), parse.regionBootstrap).chests;
    expect(chestStateChanges(new Map([['cove-chest', false]]), chests)).toEqual([
      { entityId: 'cove-chest', isOpen: true },
    ]);
    expect(chestStateChanges(new Map([['cove-chest', true]]), chests)).toEqual([]);
  });
});

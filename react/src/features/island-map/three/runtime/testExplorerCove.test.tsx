import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEngineEventBus } from '../worldEngineEvents';
import type { ThreeLocationManifest } from './locationManifest';
import { createSourceManifestRepository } from './locationManifestRepository';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { SOURCE_MANIFEST_REGISTRIES } from './sourceManifestRegistries';
import { validateLocationManifest } from './validateLocationManifest';
import { ThreeLocationWorldView } from './ThreeLocationWorldView';
import { getQuestDefinition } from '../../../quests/content';
import {
  COVE_ADVENTURE_SLUG,
  COVE_BOAT_ENTITY_ID,
  COVE_DISCOVERY_ID,
  COVE_NPC_ENTITY_ID,
  COVE_SHELL_ENTITY_ID,
  COVE_SHELL_FOUND,
  COVE_SIGNPOST_ENTITY_ID,
  COVE_TIDE_POOL_ZONE_ID,
  TEST_EXPLORER_COVE_MANIFEST as MANIFEST,
  TEST_EXPLORER_COVE_REGION_ID as REGION_ID,
} from './testing/testExplorerCove';

/**
 * Engine Phase 17, the extensibility proof (`docs/engine/11_ACCEPTANCE_TESTS.md`
 * "Final Expansion Test"): a location nobody shipped, loaded through the
 * real repository and validator and played through the one generic view,
 * covering every part the acceptance test lists. The scene is stubbed here
 * as in `ThreeLocationWorldView.test.tsx`; `testExplorerCove.engine.test.ts`
 * runs the real runtime against the same manifest.
 */
vi.mock('../../../discovery/checkpoints', async (importOriginal) => {
  const { withTestExplorerCoveCheckpoints } = await import('./testing/testExplorerCove');
  return withTestExplorerCoveCheckpoints(await importOriginal());
});

const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as { startCheckpointId?: string } | null,
}));

vi.mock('./createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (
      _parent: HTMLElement,
      bus: WorldEngineEventBus,
      _manifest: ThreeLocationManifest,
      options: { startCheckpointId?: string },
    ) => {
      engine.bus = bus;
      engine.options = options;
      return { dispose: vi.fn(), interact: vi.fn(), ready: Promise.resolve() };
    },
  ),
}));

vi.mock('../../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));
vi.mock('../../DiscoveryAction', () => ({
  DiscoveryAction: ({ discoveryId }: { discoveryId: string }) => (
    <button type="button">discover {discoveryId}</button>
  ),
}));
vi.mock('../../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
}));
vi.mock('../../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));
vi.mock('../../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../../island/api', () => ({ getCompanionProfile: vi.fn() }));
vi.mock('../../../child-profile/api', () => ({ getChildProfile: vi.fn(async () => null) }));

import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../discovery/api';
import {
  listAllWorldChanges,
  recordWorldChangeOnce,
  resumeOrStartSession,
} from '../../../adventures/api';
import { getInventory } from '../../../rewards/api';
import { listQuestStates } from '../../../quests/api';
import { getCompanionProfile } from '../../../island/api';

/** The shipped repository's construction, with the cove as one more manifest. */
const repository = createSourceManifestRepository(
  [...SOURCE_LOCATION_MANIFESTS, MANIFEST],
  SOURCE_MANIFEST_REGISTRIES,
);

function renderCove() {
  return render(
    <MemoryRouter>
      <ThreeLocationWorldView
        childId="child-1"
        regionId={REGION_ID}
        ageBand="PATHFINDER"
        repository={repository}
      />
    </MemoryRouter>,
  );
}

async function emit<Name extends Parameters<WorldEngineEventBus['emit']>[0]>(
  name: Name,
  detail: Parameters<WorldEngineEventBus['emit']>[1] & object,
) {
  await waitFor(() => expect(engine.bus).not.toBeNull());
  act(() => {
    engine.bus!.emit(name, detail as never);
  });
}

describe('Test Explorer Cove: the manifest (engine Phase 17)', () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged (acceptance A3)', () => {
    expect(JSON.parse(JSON.stringify(MANIFEST))).toEqual(MANIFEST);
  });

  it('loads through the same repository construction the app uses (acceptance A4)', async () => {
    await expect(repository.getPublished(REGION_ID)).resolves.toBe(MANIFEST);
  });

  it('uses no extension, so everything it does is ordinary engine behaviour', () => {
    expect(MANIFEST.extensions).toEqual([]);
  });

  it('feeds an existing quest: its discovery is an objective of "The Quiet Places"', () => {
    const quest = getQuestDefinition('the-quiet-places');
    const discoveryKeys = quest?.stages
      .flatMap((stage) => stage.objectives)
      .flatMap((objective) => (objective.kind === 'DISCOVER' ? [objective.discoveryKey] : []));
    expect(discoveryKeys).toContain(COVE_DISCOVERY_ID);
  });
});

describe('Test Explorer Cove: played through the generic view (engine Phase 17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    vi.mocked(getWorldState).mockResolvedValue({
      discoveredIds: [],
      metCharacterIds: [],
      lastCheckpointId: 'test-explorer-cove:rock-pools',
    });
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(recordWorldChangeOnce).mockResolvedValue(undefined);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows its environment copy, its way out, and spawns at the saved checkpoint', async () => {
    renderCove();
    expect(await screen.findByText(/Explore the cove/)).toBeInTheDocument();
    expect(screen.getByText('Something shiny is hiding near the rocks.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go back to the harbor' })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
    await waitFor(() =>
      expect(engine.options?.startCheckpointId).toBe('test-explorer-cove:rock-pools'),
    );
  });

  it('saves its checkpoint and says so in its own words', async () => {
    renderCove();
    await screen.findByText(/Explore the cove/);
    await emit('PlayerEnteredZone', { zoneId: 'test-explorer-cove:landing' });
    expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'test-explorer-cove:landing');
    expect(await screen.findByText('You found the landing.')).toBeInTheDocument();
  });

  it('records meeting Pip and opens his existing conversation', async () => {
    renderCove();
    await screen.findByText(/Explore the cove/);
    await emit('NpcApproached', { entityId: COVE_NPC_ENTITY_ID });
    expect(recordCharacterMet).toHaveBeenCalledWith('child-1', COVE_NPC_ENTITY_ID);

    await emit('ObjectInteracted', {
      entityId: COVE_NPC_ENTITY_ID,
      interactionId: `${COVE_NPC_ENTITY_ID}:talk`,
    });
    expect(screen.getByRole('dialog', { name: 'Say hello to Pip' })).toBeInTheDocument();
    expect(screen.getByTestId('npc-conversation')).toHaveTextContent(COVE_NPC_ENTITY_ID);
  });

  it('offers the existing discovery when the child walks into the tide pool', async () => {
    renderCove();
    await screen.findByText(/Explore the cove/);
    await emit('PlayerEnteredZone', { zoneId: COVE_TIDE_POOL_ZONE_ID });
    expect(screen.getByText('Water glints between the rocks.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Look into the tide pool' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `discover ${COVE_DISCOVERY_ID}` }),
    ).toBeInTheDocument();
  });

  it('opens the existing adventure from the signpost', async () => {
    renderCove();
    await screen.findByText(/Explore the cove/);
    await emit('ObjectInteracted', {
      entityId: COVE_SIGNPOST_ENTITY_ID,
      interactionId: `${COVE_SIGNPOST_ENTITY_ID}:interact`,
    });
    expect(
      screen.getByRole('dialog', { name: 'Help mend the Moonlight Bridge' }),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Start the adventure' }));
    expect(resumeOrStartSession).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ slug: COVE_ADVENTURE_SLUG }),
    );
  });

  it('records the shell as one durable fact, with its toast', async () => {
    renderCove();
    await screen.findByText(/Explore the cove/);
    await emit('CollectiblePickedUp', { entityId: COVE_SHELL_ENTITY_ID });
    expect(screen.getByText('You found a spiral shell.')).toBeInTheDocument();
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      MANIFEST.collectibles[0]?.worldChange?.locationSlug,
      'COLLECTIBLE_FOUND',
      COVE_SHELL_FOUND,
      `exploration:${COVE_SHELL_ENTITY_ID}`,
    );
  });

  it('rows the child to the travel deck', async () => {
    renderCove();
    await screen.findByText(/Explore the cove/);
    await emit('ObjectInteracted', {
      entityId: COVE_BOAT_ENTITY_ID,
      interactionId: `${COVE_BOAT_ENTITY_ID}:interact`,
    });
    expect(screen.getByRole('dialog', { name: 'Row to another island' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go there' })).toHaveAttribute(
      'href',
      '/island/child-1/travel',
    );
  });
});

/**
 * The other half of the proof: the cove needed no route, view, scene,
 * region module or runtime branch, so no production file may name it.
 */
const SRC_DIR = resolve(process.cwd(), 'src');

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === 'testing' || name === 'test' ? [] : productionFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Test Explorer Cove: what it cost (engine Phase 17)', () => {
  it('is named by no production file', () => {
    const files = productionFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(100);
    const naming = files
      .filter((path) => readFileSync(path, 'utf8').includes(REGION_ID))
      .map((path) => relative(SRC_DIR, path));
    expect(naming).toEqual([]);
  });
});

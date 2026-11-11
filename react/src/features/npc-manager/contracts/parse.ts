import { Reader } from '../../../api/parse';
import type {
  BehaviorParameters,
  BehaviorSpec,
  HintResponse,
  InteractionResponse,
  NpcAssetRef,
  NpcCatalogResponse,
  NpcSceneResponse,
  RuntimeCharacter,
  RuntimeNode,
  RuntimePlacement,
  RuntimeVariant,
} from './types';
import {
  ANIMATION_STATES,
  BEHAVIOR_TYPES,
  CHOICE_ACTIONS,
  CONTRACT_VERSION,
  DIALOGUE_MODES,
  EMOTIONS,
  NPC_ROLES,
  VARIANT_ASSET_ROLES,
  type AnimationState,
} from './vocabulary';

/**
 * Runtime readers for the NPC Manager API (contract v1). A response that does not match
 * becomes `ApiError('invalid_response')` naming the path. A newer contract version is
 * rejected rather than half-read.
 */

function contractVersion(r: Reader): number {
  const version = r.field('contractVersion').integer();
  if (version !== CONTRACT_VERSION) {
    // Reuse the Reader's failure shape for an unsupported version.
    r.field('contractVersion').oneOf([String(CONTRACT_VERSION)] as const);
  }
  return version;
}

export function readAssetRef(r: Reader): NpcAssetRef {
  return {
    assetId: r.field('assetId').string(),
    version: r.field('version').nullable((v) => v.integer()),
  };
}

function readAnimationMap(r: Reader): RuntimeVariant['animationMap'] {
  const raw = r.object();
  const map: RuntimeVariant['animationMap'] = {};
  for (const state of ANIMATION_STATES) {
    if (state in raw) map[state] = r.field(state).string();
  }
  return map;
}

function readVariant(r: Reader): RuntimeVariant {
  return {
    variantKey: r.field('variantKey').string(),
    displayName: r.field('displayName').string(),
    model: readAssetRef(r.field('model')),
    portrait: r.field('portrait').nullable(readAssetRef),
    scale: r.field('scale').number(),
    rotationOffsetY: r.field('rotationOffsetY').number(),
    positionOffsetY: r.field('positionOffsetY').number(),
    animationMap: readAnimationMap(r.field('animationMap')),
    extras: r.field('extras').array((e) => ({
      role: e.field('role').oneOf(VARIANT_ASSET_ROLES),
      asset: readAssetRef(e.field('asset')),
      attachPoint: e.field('attachPoint').string(),
    })),
  };
}

function optionalStrings(r: Reader, name: string): string[] | undefined {
  const raw = r.object();
  return name in raw ? r.field(name).array((s) => s.string()) : undefined;
}

export function readCharacter(r: Reader): RuntimeCharacter {
  const personality = r.field('personality');
  const raw = personality.object();
  return {
    npcId: r.field('npcId').string(),
    displayName: r.field('displayName').string(),
    role: r.field('role').oneOf(NPC_ROLES),
    ageBands: r.field('ageBands').array((s) => s.string()),
    personality: {
      traits: optionalStrings(personality, 'traits'),
      tone: 'tone' in raw ? personality.field('tone').string() : undefined,
      catchphrases: optionalStrings(personality, 'catchphrases'),
    },
    dialogueMode: r.field('dialogueMode').oneOf(DIALOGUE_MODES),
    voiceProfile: r.field('voiceProfile').nullable((v) => v.string()),
    defaultVariant: r.field('defaultVariant').nullable((v) => v.string()),
    variants: r.field('variants').array(readVariant),
  };
}

function readBehaviorParameters(r: Reader): BehaviorParameters {
  // Server-validated per type (apps/npcs/behaviors.py); kept as data after a shape check.
  const raw = r.object();
  r.field('boundsRadius').number();
  r.field('reactions').object();
  return raw as unknown as BehaviorParameters;
}

function readBehavior(r: Reader): BehaviorSpec {
  return {
    key: r.field('key').string(),
    type: r.field('type').oneOf(BEHAVIOR_TYPES),
    parameters: readBehaviorParameters(r.field('parameters')),
  };
}

function readPlacement(r: Reader): RuntimePlacement {
  const p = r.field('position');
  return {
    placementKey: r.field('placementKey').string(),
    npcId: r.field('npcId').string(),
    variant: r.field('variant').string(),
    behavior: r.field('behavior').nullable(readBehavior),
    position: { x: p.field('x').number(), y: p.field('y').number(), z: p.field('z').number() },
    rotationY: r.field('rotationY').number(),
    scale: r.field('scale').number(),
    interactionRadius: r.field('interactionRadius').number(),
  };
}

export function parseCatalog(value: unknown): NpcCatalogResponse {
  const r = new Reader(value);
  return {
    contractVersion: contractVersion(r),
    release: r.field('release').integer(),
    characters: r.field('characters').array(readCharacter),
  };
}

export function parseScene(value: unknown): NpcSceneResponse {
  const r = new Reader(value);
  const scope = r.field('scope');
  const charactersReader = r.field('characters');
  const characters: Record<string, RuntimeCharacter> = {};
  for (const npcId of Object.keys(charactersReader.object())) {
    characters[npcId] = readCharacter(charactersReader.field(npcId));
  }
  const placements = r.field('placements').array(readPlacement);
  for (const placement of placements) {
    const character = characters[placement.npcId];
    if (!character || !character.variants.some((v) => v.variantKey === placement.variant)) {
      // A placement must name a character and variant in the same response.
      r.field('characters').field(placement.npcId).field('variants').oneOf([placement.variant]);
    }
  }
  return {
    contractVersion: contractVersion(r),
    release: r.field('release').integer(),
    scope: {
      place: scope.field('place').string(),
      area: scope.field('area').nullable((v) => v.string()),
    },
    characters,
    placements,
  };
}

function readNode(r: Reader): RuntimeNode {
  return {
    nodeKey: r.field('nodeKey').string(),
    text: r.field('text').string(),
    emotion: r.field('emotion').oneOf(EMOTIONS),
    animationState: r
      .field('animationState')
      .nullable((v) => v.oneOf(ANIMATION_STATES) as AnimationState),
    audio: r.field('audio').nullable(readAssetRef),
    speech: r.field('speech').nullable((s) => ({
      kind: s.field('kind').oneOf(['npcDialogueNode'] as const),
      npcId: s.field('npcId').string(),
      release: s.field('release').integer(),
      dialogueKey: s.field('dialogueKey').string(),
      nodeKey: s.field('nodeKey').string(),
    })),
    allowAiHint: r.field('allowAiHint').boolean(),
  };
}

export function parseInteraction(value: unknown): InteractionResponse {
  const r = new Reader(value);
  return {
    contractVersion: contractVersion(r),
    release: r.field('release').integer(),
    npcId: r.field('npcId').string(),
    conversationId: r.field('conversationId').nullable((v) => v.string()),
    dialogueKey: r.field('dialogueKey').nullable((v) => v.string()),
    node: r.field('node').nullable(readNode),
    choices: r.field('choices').array((c) => ({
      choiceKey: c.field('choiceKey').string(),
      label: c.field('label').string(),
      action: c.field('action').oneOf(CHOICE_ACTIONS),
    })),
    ended: r.field('ended').boolean(),
    questOffer: r.field('questOffer').nullable((q) => ({ questId: q.field('questId').string() })),
  };
}

export function parseHint(value: unknown): HintResponse {
  const r = new Reader(value);
  const hint = r.field('hint');
  return {
    contractVersion: contractVersion(r),
    hint: {
      text: hint.field('text').string(),
      source: hint.field('source').oneOf(['AI', 'FALLBACK'] as const),
      speech: hint.field('speech').nullable((s) => ({
        kind: s.field('kind').oneOf(['utterance'] as const),
        id: s.field('id').string(),
      })),
    },
  };
}

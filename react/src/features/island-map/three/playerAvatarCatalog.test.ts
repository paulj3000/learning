import { describe, expect, it } from 'vitest';
import {
  effectivePlayerAnimationMap,
  parsePlayerAvatar,
  PLAYER_ANIMATION_STATES,
} from './playerAvatarCatalog';

const MODEL = {
  ref: 'player-fox@2',
  assetId: 'player-fox',
  version: 2,
  clips: ['HeroIdle', 'Walk', 'Jump', 'Fall'],
  scale: 1.1,
  rotationOffset: 3.14,
  animationMap: { idle: 'HeroIdle', walk: 'Walk', jump: 'Jump', fall: 'Fall' },
  customization: {
    colorMaterials: { Fur: 'body', Belly: 'accent' },
    attachPoints: { head: 'Head', back: 'Spine2' },
  },
};

describe('player avatar catalogue contract (LAI-JMP-01c)', () => {
  it('reads a published avatar answer', () => {
    const answer = parsePlayerAvatar({
      avatarKey: 'FOX',
      displayName: 'Fox',
      model: MODEL,
      reason: null,
    });
    expect(answer).toEqual({ avatarKey: 'FOX', displayName: 'Fox', model: MODEL, reason: null });
  });

  it('reads "no model" with its reason', () => {
    expect(
      parsePlayerAvatar({
        avatarKey: 'OWL',
        displayName: 'Owl',
        model: null,
        reason: 'not_available',
      }),
    ).toEqual({ avatarKey: 'OWL', displayName: 'Owl', model: null, reason: 'not_available' });
  });

  it('treats a malformed model as no model, so the child gets the placeholder', () => {
    for (const broken of [
      { ...MODEL, ref: 'https://evil.example/x.glb' },
      { ...MODEL, ref: '../player-fox' },
      { ...MODEL, assetId: 'player-owl' },
      { ...MODEL, version: 0 },
      { ...MODEL, scale: 50 },
      { ...MODEL, rotationOffset: 'left' },
      { ...MODEL, clips: [1, 2] },
    ]) {
      expect(
        parsePlayerAvatar({ avatarKey: 'FOX', model: broken })?.model,
        JSON.stringify(broken),
      ).toBeNull();
    }
    expect(parsePlayerAvatar(null)).toBeNull();
    expect(parsePlayerAvatar({ model: MODEL })).toBeNull();
  });

  it('drops map entries for clips the model lacks and unknown customization', () => {
    const answer = parsePlayerAvatar({
      avatarKey: 'FOX',
      model: {
        ...MODEL,
        animationMap: { idle: 'HeroIdle', jump: 'NoSuchClip', dance: 'Walk' },
        customization: {
          colorMaterials: { Fur: 'body', Eyes: 'rainbow' },
          attachPoints: { head: 'Head', tail: 'Tail', feet: '' },
          hats: ['top'],
        },
      },
    });
    expect(answer?.model?.animationMap).toEqual({ idle: 'HeroIdle' });
    expect(answer?.model?.customization).toEqual({
      colorMaterials: { Fur: 'body' },
      attachPoints: { head: 'Head' },
    });
  });

  it('fills unmapped states from the standard clip names, and only from real clips', () => {
    expect(
      effectivePlayerAnimationMap({ idle: 'HeroIdle' }, [
        'HeroIdle',
        'Walk',
        'Land',
        'Wave',
        'Celebrate',
      ]),
    ).toEqual({
      idle: 'HeroIdle',
      walk: 'Walk',
      land: 'Land',
      interact: 'Wave',
      celebrate: 'Celebrate',
    });
    expect(effectivePlayerAnimationMap({}, [])).toEqual({});
    expect(PLAYER_ANIMATION_STATES).toContain('run');
  });
});

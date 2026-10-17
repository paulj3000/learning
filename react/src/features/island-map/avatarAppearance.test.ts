import { describe, expect, it } from 'vitest';
import { getAvatarAppearance } from './avatarAppearance';
import { AVATAR_OPTIONS } from '../child-profile/constants';

describe('getAvatarAppearance', () => {
  it.each(AVATAR_OPTIONS.map((option) => option.value))(
    'returns a defined appearance with a body color for %s',
    (avatarKey) => {
      const appearance = getAvatarAppearance(avatarKey);
      expect(appearance).toBeDefined();
      expect(appearance.body).toBeTypeOf('number');
    },
  );

  it('falls back to the default look for an unrecognized avatarKey', () => {
    expect(getAvatarAppearance('NOT_A_REAL_AVATAR').accessory).toBe('NONE');
  });

  it('falls back to the default look for null, undefined, or empty input', () => {
    expect(getAvatarAppearance(null).accessory).toBe('NONE');
    expect(getAvatarAppearance(undefined).accessory).toBe('NONE');
    expect(getAvatarAppearance('').accessory).toBe('NONE');
  });
});

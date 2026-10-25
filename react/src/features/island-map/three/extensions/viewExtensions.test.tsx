import { describe, expect, it } from 'vitest';
import { SOURCE_EXTENSION_IDS, SOURCE_WORLD_EXTENSIONS } from '.';
import { VIEW_EXTENSION_IDS } from './viewExtensionIds';
import { SOURCE_VIEW_EXTENSIONS } from './viewExtensions';

describe('extension registries', () => {
  it('lists exactly the registered view extensions in the engine-side id list', () => {
    expect([...VIEW_EXTENSION_IDS].sort()).toEqual([...SOURCE_VIEW_EXTENSIONS.ids()].sort());
  });

  it('knows every world and view extension id', () => {
    expect(new Set(SOURCE_EXTENSION_IDS)).toEqual(
      new Set([...SOURCE_WORLD_EXTENSIONS.ids(), ...SOURCE_VIEW_EXTENSIONS.ids()]),
    );
  });
});

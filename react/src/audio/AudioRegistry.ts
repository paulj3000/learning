import { isAudioChannel } from './AudioChannels';
import type { SoundDefinition } from './AudioTypes';

/**
 * Sound ids to definitions. Registration is by stable id; a definition is
 * data, never a loaded file, so registering thousands costs nothing.
 *
 * Re-registering an id replaces it (hot reload, per-game overrides). Playing
 * instances keep the definition they started with.
 */
export class AudioRegistry {
  private readonly definitions = new Map<string, SoundDefinition>();
  /** Which owner registered an id. Absent means the application itself (`register`). */
  private readonly owners = new Map<string, string>();

  register(definition: SoundDefinition): void {
    const problem = validateDefinition(definition);
    if (problem) throw new RangeError(`invalid sound definition: ${problem}`);
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    this.owners.delete(definition.id);
  }

  /**
   * Replaces all of `owner`'s definitions with `definitions`, all or nothing. Returns the ids
   * refused because another owner (or the application) already holds them, or because the
   * definition is invalid; those are skipped and the rest are applied.
   */
  replaceOwned(owner: string, definitions: readonly SoundDefinition[]): string[] {
    const refused: string[] = [];
    const accepted: SoundDefinition[] = [];
    for (const definition of definitions) {
      const heldBy = this.owners.get(definition.id);
      const taken = this.definitions.has(definition.id) && heldBy !== owner;
      if (taken || validateDefinition(definition)) refused.push(String(definition.id));
      else accepted.push(definition);
    }
    this.releaseOwned(owner);
    for (const definition of accepted) {
      this.definitions.set(definition.id, Object.freeze({ ...definition }));
      this.owners.set(definition.id, owner);
    }
    return refused;
  }

  releaseOwned(owner: string): void {
    for (const [id, heldBy] of [...this.owners]) {
      if (heldBy !== owner) continue;
      this.owners.delete(id);
      this.definitions.delete(id);
    }
  }

  registerAll(definitions: readonly SoundDefinition[]): void {
    // Validate first so a bad entry registers nothing.
    for (const definition of definitions) {
      const problem = validateDefinition(definition);
      if (problem) throw new RangeError(`invalid sound definition: ${problem}`);
    }
    for (const definition of definitions) this.register(definition);
  }

  unregister(soundId: string): void {
    this.definitions.delete(soundId);
    this.owners.delete(soundId);
  }

  has(soundId: string): boolean {
    return this.definitions.has(soundId);
  }

  get(soundId: string): SoundDefinition | undefined {
    return this.definitions.get(soundId);
  }

  get size(): number {
    return this.definitions.size;
  }
}

/** Returns what is wrong with a definition, or `undefined` when it is acceptable. */
export function validateDefinition(definition: SoundDefinition): string | undefined {
  if (typeof definition.id !== 'string' || definition.id.trim() === '') {
    return 'id must be a non-empty string';
  }
  if (!isAudioChannel(definition.channel)) {
    return `${definition.id}: unknown channel "${String(definition.channel)}"`;
  }
  if (
    definition.defaultVolume !== undefined &&
    !(Number.isFinite(definition.defaultVolume) && definition.defaultVolume >= 0)
  ) {
    return `${definition.id}: defaultVolume must be a finite number from 0 to 1`;
  }
  const counts: Array<[string, number | undefined, number]> = [
    ['maxConcurrent', definition.maxConcurrent, 1],
    ['cooldownMs', definition.cooldownMs, 0],
    ['fadeInMs', definition.fadeInMs, 0],
    ['fadeOutMs', definition.fadeOutMs, 0],
  ];
  for (const [name, value, min] of counts) {
    if (value !== undefined && !(Number.isFinite(value) && value >= min)) {
      return `${definition.id}: ${name} must be a finite number of at least ${min}`;
    }
  }
  return undefined;
}

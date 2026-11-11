import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';
import type { AnimationMode } from '../contracts/engine';
import {
  ANIMATION_FALLBACKS,
  ANIMATION_PRIORITY,
  LOOPING_ANIMATION_STATES,
  type AnimationState,
} from '../contracts/vocabulary';

/**
 * One NPC's animation controller (LAI-NPC-009, docs/NPC_MANAGER_CONTRACTS.md section 6).
 *
 * Two layers:
 * - the **base** state (priority band `behavior`, always looping) follows the behaviour's
 *   locomotion (idle, walk, run);
 * - one **overlay** at a higher band (reaction, dialogue, scripted). A request at the same or a
 *   higher band than the playing overlay replaces it; a lower one is ignored (a request at the
 *   behaviour band only changes the base). A one-shot overlay returns to the base when it
 *   finishes and reports `onFinished(state)`; a looping overlay plays until `stop(band)`.
 *
 * State to clip: the variant's `animationMap`, then `ANIMATION_FALLBACKS`, then idle. Changes
 * crossfade over 0.2 s. A model with no clips at all (or the placeholder, or a model whose map
 * names none of its clips) gets a tiny procedural motion on its own position instead, which
 * reduced motion turns off; one-shots still finish on time so dialogue and reactions never wait
 * forever.
 *
 * Pure Three.js: no React, no network.
 */

export const CROSSFADE_SECONDS = 0.2;
/** How long a one-shot lasts when there is no clip to time it. */
export const PROCEDURAL_ONE_SHOT_SECONDS = 0.8;

export interface NpcAnimatorOptions {
  /** The object the clips animate (the model root), or the placeholder. */
  root: Object3D;
  clips: readonly AnimationClip[];
  animationMap: Partial<Record<AnimationState, string>>;
  reducedMotion: () => boolean;
  /** A one-shot overlay finished (not called for one that was stopped or replaced). */
  onFinished?: (state: AnimationState) => void;
  crossfadeSeconds?: number;
}

export interface PlayRequest {
  mode?: AnimationMode;
  /** ANIMATION_PRIORITY band; default dialogue. */
  priority?: number;
}

export interface NpcAnimatorSnapshot {
  base: AnimationState;
  overlay: { state: AnimationState; priority: number; mode: AnimationMode } | null;
  /** The clip currently driving the model, or null (procedural or nothing). */
  clip: string | null;
}

export interface NpcAnimator {
  /** The behaviour band's looping state (locomotion). */
  setBase(state: AnimationState): void;
  /** True when the request was accepted (not ignored for a lower band). */
  play(state: AnimationState, request?: PlayRequest): boolean;
  /** Stops the overlay at exactly this band; the behaviour band resets the base to idle. */
  stop(priority: number): void;
  update(deltaSeconds: number): void;
  snapshot(): NpcAnimatorSnapshot;
  /** The clip a state resolves to for this model, or null. */
  resolveClip(state: AnimationState): AnimationClip | null;
  dispose(): void;
}

interface Overlay {
  state: AnimationState;
  priority: number;
  mode: AnimationMode;
  clip: AnimationClip | null;
  /** Its own action, or null when timed (no clip, or the clip the base already plays). */
  action: AnimationAction | null;
  /** Seconds left for a timed one-shot; elapsed seconds for procedural motion. */
  remaining: number;
  elapsed: number;
}

export function defaultMode(state: AnimationState): AnimationMode {
  return LOOPING_ANIMATION_STATES.has(state) ? 'loop' : 'once';
}

export function createNpcAnimator(options: NpcAnimatorOptions): NpcAnimator {
  const { root, clips, animationMap } = options;
  const fade = options.crossfadeSeconds ?? CROSSFADE_SECONDS;
  const mixer = new AnimationMixer(root);
  const restY = root.position.y;
  let disposed = false;
  let base: AnimationState = 'idle';
  let baseAction: AnimationAction | null = null;
  let overlay: Overlay | null = null;
  let active: AnimationAction | null = null;
  let proceduralTime = 0;
  let bobbing = false;

  function clipNamed(name: string | undefined): AnimationClip | null {
    if (!name) return null;
    return clips.find((clip) => clip.name === name) ?? null;
  }

  // Resolved once per state: clips and the map never change for an animator (LAI-NPC-037).
  const resolved = new Map<AnimationState, AnimationClip | null>();

  function lookupClip(state: AnimationState): AnimationClip | null {
    const own = clipNamed(animationMap[state]);
    if (own) return own;
    for (const candidate of ANIMATION_FALLBACKS[state]) {
      const clip = clipNamed(animationMap[candidate]);
      if (clip) return clip;
    }
    return clipNamed(animationMap.idle);
  }

  function resolveClip(state: AnimationState): AnimationClip | null {
    let clip = resolved.get(state);
    if (clip === undefined) {
      clip = lookupClip(state);
      resolved.set(state, clip);
    }
    return clip;
  }

  function configure(action: AnimationAction, loop: boolean): void {
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
  }

  /**
   * Crossfades to `next`. When `next` already plays (one clip shared by two states, e.g. a
   * fallback), its loop mode is updated in place, and it restarts when asked to or when it had
   * already finished, so a one-shot never stays clamped on its last frame as a base.
   */
  function fadeTo(next: AnimationAction | null, loop: boolean, restart = false): void {
    if (next && next === active) {
      configure(next, loop);
      if (restart || !next.isRunning()) next.reset().play();
      return;
    }
    if (next === active) return;
    if (next) {
      next.reset();
      configure(next, loop);
      next.enabled = true;
      next.setEffectiveTimeScale(1);
      next.setEffectiveWeight(1);
      next.play();
      if (active) active.crossFadeTo(next, fade, false);
      else next.fadeIn(fade);
    } else if (active) {
      active.fadeOut(fade);
    }
    active = next;
  }

  function applyBase(): void {
    const clip = resolveClip(base);
    baseAction = clip ? mixer.clipAction(clip) : null;
    fadeTo(baseAction, true);
  }

  function endOverlay(finished: boolean): void {
    const ended = overlay;
    if (!ended) return;
    overlay = null;
    applyBase();
    if (finished) options.onFinished?.(ended.state);
  }

  function onMixerFinished(event: { action: AnimationAction }): void {
    if (overlay && overlay.action && event.action === overlay.action) endOverlay(true);
  }
  mixer.addEventListener('finished', onMixerFinished);

  applyBase();

  function setBase(state: AnimationState): void {
    if (disposed || state === base) return;
    base = state;
    if (!overlay) applyBase();
  }

  return {
    setBase,

    play(state, request = {}) {
      if (disposed) return false;
      const priority = request.priority ?? ANIMATION_PRIORITY.dialogue;
      const mode = request.mode ?? defaultMode(state);
      if (priority <= ANIMATION_PRIORITY.behavior) {
        setBase(state);
        return true;
      }
      if (overlay && priority < overlay.priority) return false;
      if (overlay && overlay.state === state && overlay.priority === priority) {
        if (overlay.mode === mode) return true; // idempotent repeat
      }
      const clip = resolveClip(state);
      // The base's own clip keeps playing; the overlay is then only timed (an action is shared
      // per clip, so changing its loop mode would also change the base).
      const ownAction = clip && clip !== baseAction?.getClip() ? mixer.clipAction(clip) : null;
      overlay = {
        state,
        priority,
        mode,
        clip,
        action: ownAction,
        remaining: clip ? clip.duration : PROCEDURAL_ONE_SHOT_SECONDS,
        elapsed: 0,
      };
      if (ownAction) fadeTo(ownAction, mode === 'loop', true);
      else fadeTo(baseAction, true);
      return true;
    },

    stop(priority) {
      if (disposed) return;
      if (priority <= ANIMATION_PRIORITY.behavior) {
        setBase('idle');
        return;
      }
      if (overlay && overlay.priority === priority) endOverlay(false);
    },

    update(deltaSeconds) {
      if (disposed) return;
      mixer.update(deltaSeconds);
      const current = overlay;
      if (current && current.mode === 'once' && !current.action) {
        current.remaining -= deltaSeconds;
        current.elapsed += deltaSeconds;
        if (current.remaining <= 0) endOverlay(true);
      } else if (current) {
        current.elapsed += deltaSeconds;
      }
      proceduralTime += deltaSeconds;
      if (active === null) {
        // Nothing drives the model: no clips at all, or none the map resolves.
        root.position.y = restY + proceduralOffset();
        bobbing = true;
      } else if (bobbing) {
        root.position.y = restY;
        bobbing = false;
      }
    },

    snapshot() {
      return {
        base,
        overlay: overlay
          ? { state: overlay.state, priority: overlay.priority, mode: overlay.mode }
          : null,
        clip: active ? active.getClip().name : null,
      };
    },

    resolveClip,

    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.removeEventListener('finished', onMixerFinished);
      mixer.stopAllAction();
      // Drop every action and binding this mixer cached (clips are shared, the caches are not).
      for (const clip of clips) mixer.uncacheClip(clip);
      mixer.uncacheRoot(root);
      resolved.clear();
      root.position.y = restY;
      overlay = null;
      active = null;
      baseAction = null;
    },
  };

  /** A small bob for a model without clips; nothing at all under reduced motion. */
  function proceduralOffset(): number {
    if (options.reducedMotion()) return 0;
    if (overlay && overlay.mode === 'once') {
      const t = Math.min(1, overlay.elapsed / PROCEDURAL_ONE_SHOT_SECONDS);
      return 0.08 * Math.sin(Math.PI * t);
    }
    const state = overlay?.state ?? base;
    if (state === 'walk' || state === 'run') {
      const rate = state === 'run' ? 6 : 4;
      return 0.03 * Math.abs(Math.sin(proceduralTime * rate));
    }
    return 0.015 * Math.sin(proceduralTime * 2);
  }
}

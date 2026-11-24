"""NPC animation inspection (LAI-LAMBDA-009), standard library only.

- `inspect`: the bounded, read-only pass over a GLB's animations, skins and joints
  (`inspect_glb`), reusing the GLB validator's container, JSON and report modules unchanged.
- `processor`: the `asset.animation_inspector` processor and its `animation-default` profile.

See `docs/processing/NPC_ANIMATION_INSPECTION.md`.
"""

from .inspect import AnimationSettings, InspectionOutcome, inspect_glb
from .processor import ANIMATION_PROFILE, AnimationInspectorProcessor, build_metadata

__all__ = [
    "ANIMATION_PROFILE",
    "AnimationInspectorProcessor",
    "AnimationSettings",
    "InspectionOutcome",
    "build_metadata",
    "inspect_glb",
]

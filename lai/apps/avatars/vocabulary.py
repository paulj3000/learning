"""The player avatar contract (LAI-JMP-01c), mirrored in React.

Mirrors `react/src/features/island-map/three/playerAvatarCatalog.ts`;
`tests/test_contract_mirror.py` fails if the two drift apart.
"""

from django.db import models

#: The six identities a parent can choose for a child (`ChildProfile.avatar_key`). Mirrors
#: `apps.users.serializers.AVATAR_KEYS` and React's `AVATAR_OPTIONS`.
AVATAR_KEYS = ("FOX", "OWL", "OTTER", "DRAGON", "ROBOT", "MERMAID")
AVATAR_DISPLAY_NAMES = {
    "FOX": "Fox",
    "OWL": "Owl",
    "OTTER": "Otter",
    "DRAGON": "Dragon",
    "ROBOT": "Robot",
    "MERMAID": "Mermaid",
}

#: The player animation states an avatar's `animation_map` may name, each to one of the model's
#: real clip names. `run` is reserved for a future run speed.
PLAYER_ANIMATION_STATES = (
    "idle",
    "walk",
    "run",
    "jump",
    "fall",
    "land",
    "interact",
    "celebrate",
)

#: The clip names tried, in order, for a state the map leaves out (the GLB naming convention).
DEFAULT_CLIPS: dict[str, tuple[str, ...]] = {
    "idle": ("Idle",),
    "walk": ("Walk",),
    "run": ("Run",),
    "jump": ("Jump",),
    "fall": ("Fall",),
    "land": ("Land",),
    "interact": ("Point", "Wave", "Activate"),
    "celebrate": ("Celebrate",),
}

#: Named places on a model where future cosmetics attach (hats, backpacks, shoes...). An avatar's
#: `customization.attachPoints` maps each slot it supports to one of its node or bone names.
ATTACHMENT_SLOTS = ("head", "back", "hand_left", "hand_right", "feet")

#: Which of the child's avatar colours (`avatarAppearance.ts`) a named material takes.
COLOR_ROLES = ("body", "accent")

#: The keys `customization` may hold.
CUSTOMIZATION_KEYS = ("colorMaterials", "attachPoints")


class AvatarStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft (children get the placeholder)"
    AVAILABLE = "AVAILABLE", "Available (children get this model)"
    DISABLED = "DISABLED", "Disabled (children get the placeholder)"

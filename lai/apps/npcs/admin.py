"""NPC Manager Django Admin entry point (autodiscovered). Foundation-owned: one import per owner.

- `admin_characters`: workstream A (LAI-NPC-005): characters, variants, placements, dialogue
  authoring, releases (validate, publish, rollback, retire), dependency reports.
- `admin_behavior`: workstream D (LAI-NPC-019, 025): behaviour profiles and their preview.
- `admin_persona`: workstream F (LAI-NPC-031): versioned personas and approval.
"""

from . import admin_behavior, admin_characters, admin_persona  # noqa: F401

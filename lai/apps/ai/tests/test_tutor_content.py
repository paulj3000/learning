"""The Python curriculum mirror matches the content export (LAI-0701).

The golden vectors check the same data through `buildTutorContext`; this test names the drift
directly when the curriculum export changes.
"""

import json

from django.conf import settings

from apps.ai.tutor_content import SKILL_VOCABULARY, SKILLS, is_tutorable_skill


def _exported_skills():
    path = settings.CONTENT_DIR / "exported" / "curriculum.json"
    return json.loads(path.read_text(encoding="utf-8"))["skills"]


def test_skills_mirror_the_curriculum_export():
    exported = {
        s["id"]: (
            s["title"],
            s["description"],
            tuple(s["representations"]),
            tuple(s["prerequisiteSkillIds"]),
        )
        for s in _exported_skills()
    }
    mirrored = {
        s.id: (s.title, s.description, s.representations, s.prerequisite_skill_ids) for s in SKILLS
    }
    assert mirrored == exported


def test_every_skill_with_vocabulary_is_a_curriculum_skill():
    assert set(SKILL_VOCABULARY) <= {s.id for s in SKILLS}


def test_an_unknown_skill_is_never_tutorable():
    assert not is_tutorable_skill("multiplication")

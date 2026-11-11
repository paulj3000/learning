"""Server-built mastery context for the tutor (LAI-0603): authoritative, coarse, child-scoped."""

import json
from datetime import timedelta

import pytest
from django.db import DatabaseError
from django.utils import timezone

from apps.ai.services import learner
from apps.education.models import SkillEvidence, SkillProgress

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

TUTOR = {"skillId": "addition-within-ten", "templateId": "t-1", "hintLevel": 1}


def post(api, parent, child, body=None):
    return api(parent).post(
        f"/api/v1/children/{child.pk}/ai/tutor-turns/",
        json.dumps({**TUTOR, **(body or {})}),
        content_type="application/json",
    )


def profile_sent(fake):
    text = fake.requests[0].content[0].text
    context = json.loads(text.split("\n", 1)[1].split("\n\nReply")[0])
    return context.get("learnerProfile"), text


def progress(child, code, level, *, pattern="", exposures=6, days_ago=1, independent=5):
    return SkillProgress.objects.create(
        child=child,
        learning_objective_code=code,
        exposure_count=exposures,
        independent_success_count=independent,
        recent_level=level,
        error_pattern=pattern,
        last_practiced_at=timezone.now() - timedelta(days=days_ago),
    )


def test_a_child_with_no_progress_gets_a_new_learner_profile(families, api, fake_model):
    fake = fake_model()
    assert post(api, families.a, families.a1).json()["source"] == "AI"
    profile, _ = profile_sent(fake)
    assert profile == {
        "skillLevel": "NEW",
        "needsExtraPractice": False,
        "recentSupport": "NONE",
        "unmetPrerequisiteTitles": ["Counting sets of objects"],
        "completedSkillTitles": [],
        "practiceSkillTitles": [],
    }


def test_incomplete_prerequisites_are_named_by_title_only(families, api, fake_model):
    progress(families.a1, "counting-sets", "DEVELOPING", independent=1)
    fake = fake_model()
    post(api, families.a, families.a1)
    profile, _ = profile_sent(fake)
    assert profile["unmetPrerequisiteTitles"] == ["Counting sets of objects"]
    assert profile["completedSkillTitles"] == []


def test_an_advanced_learner_reads_confident_with_completed_skills(families, api, fake_model):
    progress(families.a1, "counting-sets", "MASTERED")
    progress(families.a1, "addition-within-ten", "MASTERED")
    fake = fake_model()
    post(api, families.a, families.a1)
    profile, text = profile_sent(fake)
    assert profile["skillLevel"] == "CONFIDENT" and profile["unmetPrerequisiteTitles"] == []
    assert profile["completedSkillTitles"] == ["Counting sets of objects"]
    assert "MASTERED" not in text  # statuses are mapped to closed labels, never passed through


def test_a_skill_needing_practice_is_flagged_from_the_server_pattern(families, api, fake_model):
    progress(families.a1, "addition-within-ten", "INTRODUCED", pattern="STALLED", independent=0)
    fake = fake_model()
    post(api, families.a, families.a1)
    profile, _ = profile_sent(fake)
    assert profile["needsExtraPractice"] is True and profile["skillLevel"] == "NEW"
    assert profile["practiceSkillTitles"] == [learner.get_skill("addition-within-ten").title]


def test_review_decay_lowers_a_stale_skill(families):
    progress(families.a1, "counting-sets", "MASTERED", days_ago=40)
    snap = learner.snapshots(families.a1)["counting-sets"]
    assert snap.status == "PROFICIENT"
    assert SkillProgress.objects.get(child=families.a1).recent_level == "MASTERED"  # not rewritten


def test_recent_support_is_summarised_from_evidence(families):
    for support in (0, 0, 0):
        SkillEvidence.objects.bulk_create(
            [
                SkillEvidence(
                    child=families.a1,
                    adventure_session=_session(families.a1),
                    learning_objective_code="counting-sets",
                    evidence_type="NUMBER_INPUT",
                    result="CORRECT",
                    support_level=support,
                    observed_at=timezone.now(),
                )
            ]
        )
    assert learner._recent_support(families.a1, "counting-sets") == "INDEPENDENT"
    assert learner._recent_support(families.a2, "counting-sets") == "NONE"


def _session(child):
    from apps.game_sessions.models import AdventureSession

    return AdventureSession.objects.filter(child=child).first() or _make_session(child)


def _make_session(child):
    from apps.catalog.importer import import_content
    from apps.catalog.models import Adventure
    from apps.game_sessions import services

    if not Adventure.objects.filter(slug="ai-bridge").exists():
        import_content()
    adventure = Adventure.objects.first()
    return services.start_or_resume_session(child, adventure)[0]


def test_another_childs_progress_never_reaches_this_childs_prompt(families, api, fake_model):
    progress(families.a2, "counting-sets", "MASTERED")
    progress(families.b1, "counting-sets", "MASTERED")
    fake = fake_model()
    post(api, families.a, families.a1)
    profile, text = profile_sent(fake)
    assert profile["completedSkillTitles"] == [] and profile["skillLevel"] == "NEW"
    assert profile["unmetPrerequisiteTitles"] == ["Counting sets of objects"]
    assert families.a2.nickname not in text and families.b1.nickname not in text


def test_a_browser_cannot_supply_or_change_mastery(families, api, fake_model):
    progress(families.a1, "counting-sets", "DEVELOPING", independent=1)
    fake = fake_model()
    body = {
        "learnerProfile": {"skillLevel": "CONFIDENT"},
        "mastery": "MASTERED",
        "knownPrerequisiteTitles": ["Counting sets of objects"],
    }
    post(api, families.a, families.a1, body)
    profile, _ = profile_sent(fake)
    assert profile["skillLevel"] == "NEW"
    assert profile["unmetPrerequisiteTitles"] == ["Counting sets of objects"]


def test_a_turn_never_writes_mastery(families, api, fake_model):
    progress(families.a1, "counting-sets", "DEVELOPING", independent=1)
    before = list(SkillProgress.objects.values_list("pk", "exposure_count", "recent_level"))
    fake_model()
    post(api, families.a, families.a1)
    assert before == list(SkillProgress.objects.values_list("pk", "exposure_count", "recent_level"))
    assert not SkillEvidence.objects.exists()


def test_an_unreadable_progress_store_falls_back_to_the_plain_context(
    families, api, fake_model, monkeypatch
):
    def boom(*args, **kwargs):
        raise DatabaseError("secret-row-values")

    monkeypatch.setattr(learner, "snapshots", boom)
    fake = fake_model()
    response = post(api, families.a, families.a1)
    assert response.status_code == 200 and response.json()["source"] == "AI"
    profile, text = profile_sent(fake)
    assert profile is None and "secret-row-values" not in text
    assert learner.build_learner_context(families.a1, "counting-sets") is None


def test_an_unknown_skill_has_no_profile(families):
    assert learner.build_learner_context(families.a1, "not-a-skill") is None

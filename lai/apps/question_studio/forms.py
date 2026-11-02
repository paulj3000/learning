"""The Generate Questions form (LAI-AQS-015). Choice sets come from the taxonomy, so staff can
only request values the Studio understands; free text is limited to short notes."""

from django import forms

from apps.catalog.models import Adventure, Location, World

from . import contracts, taxonomy


def _topic_choices():
    return [
        (topic, f"{subject.label}: {topic}")
        for subject in taxonomy.Subject
        for topic in sorted(taxonomy.TOPICS[subject])
    ]


class GenerateQuestionsForm(forms.Form):
    subject = forms.ChoiceField(choices=taxonomy.Subject.choices, initial="MATH")
    grade = forms.ChoiceField(choices=taxonomy.Grade.choices, initial="3")
    topic = forms.ChoiceField(choices=_topic_choices)
    skill_code = forms.SlugField(
        required=False,
        label="Skill or objective code",
        help_text="A catalog learning objective code. Treasure Rush needs one to record progress.",
    )
    difficulty = forms.ChoiceField(
        choices=[(taxonomy.MIXED, "Mixed"), *taxonomy.Difficulty.choices], initial=taxonomy.MIXED
    )
    question_type = forms.ChoiceField(choices=taxonomy.QuestionType.choices)
    count = forms.IntegerField(min_value=1, label="Number of questions", initial=10)
    world = forms.ModelChoiceField(World.objects.all(), required=False, label="Target island")
    location = forms.ModelChoiceField(Location.objects.all(), required=False, label="Target place")
    adventure = forms.ModelChoiceField(
        Adventure.objects.all(), required=False, label="Target adventure"
    )
    include_hints = forms.BooleanField(required=False, initial=True)
    include_explanations = forms.BooleanField(required=False, initial=True)
    notes = forms.CharField(
        required=False,
        max_length=contracts.MAX_NOTES_CHARS,
        label="Notes for the writer",
        help_text="Optional topic hint. Sent to the model as untrusted text.",
    )

    def clean(self):
        data = super().clean()
        subject, topic = data.get("subject"), data.get("topic")
        if subject and topic and not taxonomy.topic_is_valid(subject, topic):
            self.add_error("topic", "This topic does not belong to the chosen subject.")
        return data

    def params(self) -> contracts.GenerationParams:
        data = self.cleaned_data
        return contracts.GenerationParams(
            subject=data["subject"],
            grade=data["grade"],
            topic=data["topic"],
            difficulty=data["difficulty"],
            question_type=data["question_type"],
            count=data["count"],
            skill_code=data["skill_code"],
            include_hints=data["include_hints"],
            include_explanations=data["include_explanations"],
            world_id=data["world"].pk if data["world"] else None,
            location_id=data["location"].pk if data["location"] else None,
            adventure_id=data["adventure"].pk if data["adventure"] else None,
            notes=data["notes"],
        )

"""Question types and curriculum taxonomy (LAI-AQS-002).

Django-owned choice sets. No external standards identifiers are stored: a question names an
internal subject, grade and topic, and a skill code that is a `LearningObjective.code` when the
catalog holds one. The grade to age band table decides which children may ever be served a
question (CLAUDE.md section 3), and the question type registry is the single place a future
type is added.
"""

from dataclasses import dataclass

from django.db import models

from apps.users.models import AgeBand


class Subject(models.TextChoices):
    MATH = "MATH", "Mathematics"
    READING = "READING", "Reading"
    SCIENCE = "SCIENCE", "Science"


class Grade(models.TextChoices):
    K = "K", "Kindergarten"
    G1 = "1", "Grade 1"
    G2 = "2", "Grade 2"
    G3 = "3", "Grade 3"
    G4 = "4", "Grade 4"
    G5 = "5", "Grade 5"
    G6 = "6", "Grade 6"
    G7 = "7", "Grade 7"
    G8 = "8", "Grade 8"


class Difficulty(models.TextChoices):
    EASY = "EASY", "Easy"
    MEDIUM = "MEDIUM", "Medium"
    HARD = "HARD", "Hard"


# A request value only: each stored question has one concrete difficulty.
MIXED = "MIXED"
REQUEST_DIFFICULTIES = [*Difficulty.values, MIXED]


class QuestionType(models.TextChoices):
    MULTIPLE_CHOICE = "MULTIPLE_CHOICE", "Multiple choice"
    NUMERIC = "NUMERIC", "Numeric"
    SHORT_ANSWER = "SHORT_ANSWER", "Short answer"


class Operation(models.TextChoices):
    """Arithmetic questions carry their operands so Django can verify the answer key."""

    ADD = "ADD", "Add"
    SUBTRACT = "SUBTRACT", "Subtract"
    MULTIPLY = "MULTIPLY", "Multiply"
    DIVIDE = "DIVIDE", "Divide (exact)"


TOPICS: dict[str, frozenset[str]] = {
    Subject.MATH: frozenset(
        {"counting", "addition", "subtraction", "multiplication", "division", "measurement"}
    ),
    Subject.READING: frozenset({"vocabulary", "comprehension", "phonics"}),
    Subject.SCIENCE: frozenset({"animals", "plants", "weather", "materials"}),
}

# Topic -> the operation an arithmetic question about it must use.
TOPIC_OPERATION = {
    "addition": Operation.ADD,
    "subtraction": Operation.SUBTRACT,
    "multiplication": Operation.MULTIPLY,
    "division": Operation.DIVIDE,
}

# Which age bands a grade can be served to. Reading volume and response mode still follow the
# child's band, so a grade never widens what a band may see.
GRADE_BANDS: dict[str, frozenset[str]] = {
    Grade.K: frozenset({AgeBand.SPROUT, AgeBand.PATHFINDER}),
    Grade.G1: frozenset({AgeBand.PATHFINDER}),
    Grade.G2: frozenset({AgeBand.PATHFINDER, AgeBand.EXPLORER}),
    Grade.G3: frozenset({AgeBand.EXPLORER}),
    Grade.G4: frozenset({AgeBand.EXPLORER}),
    Grade.G5: frozenset({AgeBand.EXPLORER}),
    Grade.G6: frozenset({AgeBand.EXPLORER}),
    Grade.G7: frozenset({AgeBand.EXPLORER}),
    Grade.G8: frozenset({AgeBand.EXPLORER}),
}

# Largest numbers a question stem or answer may use, by the youngest band the grade serves.
MAX_ANSWER = {
    Grade.K: 10,
    Grade.G1: 20,
    Grade.G2: 100,
    Grade.G3: 1000,
    Grade.G4: 10000,
}
DEFAULT_MAX_ANSWER = 32767  # the ChallengeAttempt answer column (SmallIntegerField)

# Largest stem length by grade, in characters: a reading-volume guard (CLAUDE.md section 3).
MAX_STEM_CHARS = {Grade.K: 80, Grade.G1: 120, Grade.G2: 160}
DEFAULT_MAX_STEM_CHARS = 240

MAX_CHOICES = 5
MIN_CHOICES = 2
CHOICE_IDS = ("A", "B", "C", "D", "E")


def bands_for_grade(grade: str) -> frozenset[str]:
    return GRADE_BANDS.get(grade, frozenset())


def max_answer_for(grade: str) -> int:
    return MAX_ANSWER.get(grade, DEFAULT_MAX_ANSWER)


def max_stem_chars_for(grade: str) -> int:
    return MAX_STEM_CHARS.get(grade, DEFAULT_MAX_STEM_CHARS)


def topic_is_valid(subject: str, topic: str) -> bool:
    return topic in TOPICS.get(subject, frozenset())


@dataclass(frozen=True, slots=True)
class QuestionTypeSpec:
    """What the Studio does for one question type. A new type is one entry in `QUESTION_TYPES`."""

    value: str
    needs_choices: bool
    # True when Django can check the answer key without a human (arithmetic, choice references).
    machine_verifiable: bool
    # Whether the Treasure Rush challenge path can serve it today (integer answer only).
    integer_servable: bool


QUESTION_TYPES: dict[str, QuestionTypeSpec] = {
    QuestionType.MULTIPLE_CHOICE: QuestionTypeSpec(QuestionType.MULTIPLE_CHOICE, True, True, True),
    QuestionType.NUMERIC: QuestionTypeSpec(QuestionType.NUMERIC, False, True, True),
    QuestionType.SHORT_ANSWER: QuestionTypeSpec(QuestionType.SHORT_ANSWER, False, False, False),
}

# Future types (ordering, matching, true/false) register in `QUESTION_TYPES` with their own
# validator and grader; nothing else in the Studio switches on a type string.

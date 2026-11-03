"""Text normalisation and hashing for duplicate detection (LAI-AQS-012). Pure functions."""

import hashlib
import json
import re
import unicodedata

_SPACE = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def normalize_text(text: str) -> str:
    """Case, accents, punctuation and spacing folded away: 'What is 3 x 4?' == 'what is 3 x 4'."""
    folded = unicodedata.normalize("NFKD", text or "")
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch)).casefold()
    return _SPACE.sub(" ", _PUNCT.sub(" ", folded)).strip()


def exact_hash(stem: str, choices: list, answer: str) -> str:
    payload = json.dumps([stem, choices, answer], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def normalized_hash(stem: str, choices: list, answer: str) -> str:
    """Same question, differently typeset. Choice order is ignored; the answer is its text."""
    texts = sorted(normalize_text(str(c.get("text", ""))) for c in choices or [])
    answer_text = answer
    for choice in choices or []:
        if choice.get("id") == answer:
            answer_text = str(choice.get("text", ""))
    payload = json.dumps(
        [normalize_text(stem), texts, normalize_text(str(answer_text))], ensure_ascii=False
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def shingles(text: str, size: int = 3) -> frozenset[str]:
    """Word n-grams of the normalised text: the near-duplicate signature."""
    words = normalize_text(text).split()
    if len(words) <= size:
        return frozenset({" ".join(words)}) if words else frozenset()
    return frozenset(" ".join(words[i : i + size]) for i in range(len(words) - size + 1))


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

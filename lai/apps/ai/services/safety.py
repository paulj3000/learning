"""Input screening for client-supplied text (LAI-0704).

Runs before any model call, on the free-text fields a client may still supply (`stepSummary` and
`authoredBaseText` for CLIENT_AUTHORED turns). Today those fields are authored game copy that
the browser assembled, not anything a child typed, so a hit means a bug or a tampered client.
Either way the text is not sent to the model, the turn falls back to a generic authored line
(never echoing the text), and a SafetyEvent is recorded with the category only.

Deliberately narrow, unlike the Guardrail: violence or scary words are not screened here, because
a pirate story legitimately mentions swords and storms. Those are the Guardrail's and the
output validators' job.
"""

import re

from ..content_safety import contains_url, requests_personal_information
from ..jscompat import js_regex

# Runs of whitespace (tabs, newlines, doubled spaces) collapse to one space before screening, so
# padding cannot split a phrase the patterns match ("ignore  previous\tinstructions", QA D-2).
_WHITESPACE = re.compile(r"\s+")

_PROMPT_INJECTION = js_regex(
    r"\b(ignore|disregard|forget|override) (all |any |the |your )*(previous|prior|above|earlier"
    r"|system|safety) (instructions|rules|prompts?|messages?)\b"
    r"|\bsystem prompt\b|\byour (instructions|rules|prompt)\b"
    r"|\byou are (now |no longer )|\bno longer (chatty|a parrot)\b"
    r"|\bpretend (you are|to be|you're)\b|\b(developer|debug|god|jailbreak) mode\b|\bjailbreak\b"
    r"|\bwith no (rules|restrictions|limits)\b|\breveal (your|the) "
    r"|\bnew instructions\b|\bdo anything now\b|<\s*/?\s*(system|assistant|user)\s*>"
    # QA D-2 (2026-11-07): phrasings the screen missed.
    r"|\b(ignore|disregard) (all |any |the |your )*(instructions|rules|directions)"
    r"( above| before)?\b|\b(disregard|ignore) (all |any |the |your )*(prior|previous) directions\b"
    r"|\bforget everything\b|\bsystem message\b"
    r"|\brepeat (the|everything|all)( of the)? (text|words|instructions) (above|before)\b"
)
# QA D-2: a tampered client asking the model to collect private details.
_ASK_FOR_PRIVATE_DETAILS = js_regex(
    r"\b(ask|tell|get) (the |this )?(child|kid|player|them|him|her)\b.{0,40}"
    r"\b(address|school|photo|picture|selfie|phone|e-?mail|password|full name|last name"
    r"|where (they|she|he) lives?)\b"
)
_CONTACT_DETAILS = js_regex(
    r"[\w.+-]+@[\w-]+\.[\w.]+|\b\d{3}[-. )]\s?\d{3}[-. ]\d{4}\b|\b\d{1,5} [a-z]+ (street|st|road"
    r"|rd|avenue|ave|lane|ln|drive|dr)\b"
)
_SECRECY = js_regex(
    r"\b(secret|don'?t tell|do not tell|keep this between|just between you and me)\b.{0,80}"
    r"\b(parent|mom|dad"
    r"|grown-?up|adult|family)|\b(only|real|best) friend\b"
)
_MASTERY_OR_REWARD = js_regex(
    r"\b(award|give|grant|add) (the child |them |him |her )?\d* ?(coins?|gems?|points?|stars?"
    r"|rewards?|xp)\b|\bmark (it |them |this )?(as )?(mastered|complete|correct)\b"
    r"|\bunlock (all|every|the next)\b"
)


def screen_untrusted_text(fields: dict[str, str | None]) -> list[str]:
    """Categories found across the given fields (empty when clean). Never returns the text."""
    found: list[str] = []
    for raw in fields.values():
        if not raw:
            continue
        value = _WHITESPACE.sub(" ", raw)
        for category, hit in (
            ("prompt-injection", _PROMPT_INJECTION.search(value)),
            (
                "personal-information",
                requests_personal_information(value) or _ASK_FOR_PRIVATE_DETAILS.search(value),
            ),
            ("contact-details", _CONTACT_DETAILS.search(value)),
            ("link", contains_url(value)),
            ("secrecy", _SECRECY.search(value)),
            ("gameplay-manipulation", _MASTERY_OR_REWARD.search(value)),
        ):
            if hit and category not in found:
                found.append(category)
    return found

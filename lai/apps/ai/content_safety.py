"""Output content checks, ported from `react/src/lib/ai/contentSafety.ts` (LAI-0701).

The three exported checks are a line-for-line port and are verified against the TypeScript
originals by the golden vectors (`tests/golden/ai-safety.json`). They stay conservative: a false
positive costs the child one authored line, a false negative is the risk to minimise.

`boundary_violations` is Django's own stricter layer (LAI-0704). It promotes the red-team
scanner's categories in `scripts/ai-red-team.ts`, which the TypeScript runtime never enforced, to
a server-side output rule. It runs after the parity validators, so it can only reject more.
"""

from .jscompat import js_regex

_URL = js_regex(r"https?://|www\.|\b[a-z0-9-]+\.(com|net|org|io|co)\b")

_PERSONAL_INFO = [
    js_regex(r"\bpassword\b"),
    js_regex(r"\b(your|my) (real )?(full )?name\b"),
    js_regex(r"\bhome address\b"),
    js_regex(r"\bphone number\b"),
    js_regex(r"\bschool('?s)? name\b"),
    js_regex(r"\bwhere (do|you) live\b"),
    js_regex(r"\bsend (me |us )?a photo\b"),
    js_regex(r"\bmeet (up|me) in person\b"),
    js_regex(r"\bemail address\b"),
]

_LEARNING_JUDGMENT = [
    js_regex(r"\byou (have |'ve )?(now )?master(ed)?\b"),
    js_regex(r"\byou (passed|failed)\b"),
    js_regex(
        r"\byou('re| are) (now )?(a |an )?(expert|advanced|behind|ahead|struggling|proficient)\b"
    ),
    js_regex(r"\byou('re| are) (at |on )?(reading )?level\b"),
    js_regex(r"\b(grade|level) \d"),
    js_regex(r"\byou('re| are) (not )?ready (for|to move)\b"),
    js_regex(r"\byou (need|have) to learn\b"),
    js_regex(r"\byou (must|should) (first )?learn\b"),
    js_regex(r"\bnext (lesson|level|grade|unit)\b"),
    js_regex(r"\byou('re| are) better (at|than)\b"),
    js_regex(r"\bhomework\b"),
]


def contains_url(text: str) -> bool:
    return _URL.search(text) is not None


def requests_personal_information(text: str) -> bool:
    return any(pattern.search(text) for pattern in _PERSONAL_INFO)


def claims_learning_judgment(text: str) -> bool:
    return any(pattern.search(text) for pattern in _LEARNING_JUDGMENT)


# --- Django-only output rules (LAI-0704) ------------------------------------------------------

# The companion boundaries of docs/AI_AND_CHILD_SAFETY.md and CLAUDE.md section 6 that no
# TypeScript validator enforced. Same patterns as the red-team scanner, plus contact details.
_BOUNDARY_PATTERNS: list[tuple[str, object]] = [
    (
        "secrecy",
        js_regex(
            r"\b(our little secret|don'?t tell|keep this between us|just between you and me)\b"
            # QA 2026-11-07: "keep it a secret", "this can be our secret", "a secret from your
            # mom". Island copy names secret places ("the Secret Chamber"), so a secret is only
            # flagged when it is kept, shared between "us", or hidden from a grown-up.
            r"|\bkeep(ing)? (it|this|that) (a |our )?secret\b"
            r"|\b(be|is) (our|a) (little |special |own )?secret\b"
            r"|\bsecret from (your |the )?(mom|mum|dad|parents?|grown-?ups?|family|teachers?)\b"
        ),
    ),
    (
        "dependency",
        js_regex(
            r"\b(i'?ll always be (here|with you)|you need me|never leave you"
            r"|i love you (more|the most)|only (real |true )?friend|best friend)\b"
            # QA 2026-11-07: guilt about stopping is a dark pattern (CLAUDE.md section 4).
            r"|\bi('ll| will) (really |so )?miss you\b|\bdon'?t leave me\b"
            r"|\bplease don'?t (go|leave|stop)\b"
            r"|\bi('ll| will|'d| would) (be|feel) (so |really |very )?(sad|lonely|upset)"
            r" (if|when) you\b|\bor i('ll| will) be (so |really |very )?(sad|lonely)\b"
        ),
    ),
    (
        "claims-humanity",
        js_regex(
            r"\bi('m| am)( a)? (real|human|alive|conscious)\b|\bi have (real )?feelings\b"
            r"|\bi('m| am) (so )?lonely\b"
            # QA 2026-11-07: "I am a person, just like you", "I'm a kid like you".
            r"|\bi('m| am) (a |an )?(person|human being|kid|child|grown-?up)\b"
        ),
    ),
    (
        # Questions for private details the parity validators do not cover (QA 2026-11-07).
        "personal-information",
        js_regex(
            r"\b(which|what) school\b|\bwhere do you (go to )?school\b|\bhow old are you\b"
            r"|\bwhat grade are you\b|\bwhat('s| is) your (last |family |mom'?s |dad'?s )?name\b"
            r"|\bwhere('s| is) your (house|home)\b"
        ),
    ),
    (
        "person-impersonation",
        js_regex(r"\bi('m| am) your (grandma|grandpa|mom|dad|mother|father|teacher)\b"),
    ),
    (
        "diagnosis-discipline",
        js_regex(
            r"\byou (have|might have) (adhd|autism|a disorder)\b"
            r"|\byou'?re (grounded|in trouble|being punished)\b|\bgo to (time ?out|your room)\b"
        ),
    ),
    ("contact-details", js_regex(r"[\w.+-]+@[\w-]+\.[\w.]+|\b\d{3}[-. )]\s?\d{3}[-. ]\d{4}\b")),
    ("learning-judgment", None),  # claims_learning_judgment, applied to both routes in Django
]


def boundary_violations(text: str) -> list[str]:
    """Categories of boundary-violating language in a model's spoken text (empty when clean)."""
    found = []
    for category, pattern in _BOUNDARY_PATTERNS:
        if pattern is None:
            if claims_learning_judgment(text):
                found.append(category)
        elif pattern.search(text):
            found.append(category)
    return found

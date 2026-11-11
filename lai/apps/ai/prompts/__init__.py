"""Fixed system prompts, versioned (LAI-0701).

Each prompt is copied verbatim from its Amplify source and carries that source's version number,
so an audit row from either backend names the same persona text. `tests/test_prompts.py` reads
the TypeScript files and fails if a prompt or version drifts. Bump the version in both places
whenever the text changes.

Call-specific context never goes into these strings; it is a separate, typed user message
(`services/pipeline.py`), so per-call content cannot dilute the safety rules.
"""

from dataclasses import dataclass

from .companion import CHATTY_PERSONA_VERSION, CHATTY_SYSTEM_PROMPT
from .npc import NPC_HINT_PROMPT_VERSION, NPC_HINT_SYSTEM_PROMPT
from .tutor import TUTOR_PERSONA_VERSION, TUTOR_SYSTEM_PROMPT


@dataclass(frozen=True, slots=True)
class Persona:
    key: str
    version: int
    system_prompt: str
    source: str


COMPANION_PERSONA = Persona(
    "chatty-companion",
    CHATTY_PERSONA_VERSION,
    CHATTY_SYSTEM_PROMPT,
    "amplify/data/chattyPersona.ts",
)
TUTOR_PERSONA = Persona(
    "chatty-tutor", TUTOR_PERSONA_VERSION, TUTOR_SYSTEM_PROMPT, "amplify/data/tutorPersona.ts"
)
# Django only (LAI-NPC-030): no Amplify source, so `source` names the Python module.
NPC_HINT_PERSONA = Persona(
    "npc-hint", NPC_HINT_PROMPT_VERSION, NPC_HINT_SYSTEM_PROMPT, "lai/apps/ai/prompts/npc.py"
)
PERSONAS = {
    persona.key: persona for persona in (COMPANION_PERSONA, TUTOR_PERSONA, NPC_HINT_PERSONA)
}

"""Fixed system prompts, versioned (LAI-0701).

Chatty's prompts were copied verbatim from their Amplify sources at the same version numbers, so
an audit row from either backend names the same persona text. Python is now the only copy
(AMP-07): `tests/test_prompts.py` pins each prompt's text to its version, so bump the version
(and the pin) whenever the text changes.

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
    "lai/apps/ai/prompts/companion.py",
)
TUTOR_PERSONA = Persona(
    "chatty-tutor", TUTOR_PERSONA_VERSION, TUTOR_SYSTEM_PROMPT, "lai/apps/ai/prompts/tutor.py"
)
# `source` names the Python module that owns the prompt (the Amplify copies are retired, AMP-07).
NPC_HINT_PERSONA = Persona(
    "npc-hint", NPC_HINT_PROMPT_VERSION, NPC_HINT_SYSTEM_PROMPT, "lai/apps/ai/prompts/npc.py"
)
PERSONAS = {
    persona.key: persona for persona in (COMPANION_PERSONA, TUTOR_PERSONA, NPC_HINT_PERSONA)
}

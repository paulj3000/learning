"""The North Pole NPCs as NPC Manager content (NP-020, `docs/north-pole/NORTH_POLE_DESIGN.md` 7).

Ten characters: Santa Claus, Mrs. Claus, Jingle, Tinker, Peppermint, Frosty, Noel, Ginger,
Polaris and Snowball the reindeer calf. Identity is the canonical `catalog.NpcDefinition` that
the content export creates (ADR-033); this module never creates or edits it.
`seed_npc_north_pole` applies the rows below create-only, so staff edits survive a rerun.

Nothing here grants, unlocks or completes anything. Choice actions used are `NONE`, `END`,
`OFFER_QUEST` (accepting stays the child's own tap through the quests API) and, for hybrid
characters only, `REQUEST_HINT`. `allow_ai_hint` is set only on hint nodes, and each hint node
carries its authored text, which is the fallback whenever AI is off or refused.

Copy rules: readable aloud, no em dash, no question about the child's name, age, address,
school or other private details, no secrets, never claims to be human. Anything magical is island
magic (the Christmas Star); Noel, Frosty and Polaris start science with "Real ...". Frosty is an
elf who skates, never a snowman (NP-D6).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .pip_content import Choice, Dialogue, Node
from .vocabulary import BehaviorType, NpcRole

REGION_ID = "north-pole-village"
PLACE_SLUG = "north-pole-village"
AGE_BANDS = ["SPROUT", "PATHFINDER", "EXPLORER"]
BAND_ORDER = ("SPROUT", "PATHFINDER", "EXPLORER")
VARIANT_KEY = "classic"
INTERACTION_RADIUS = 3.0

#: Contract section 6 quest ids, by short code.
QUESTS = {
    "q01": "np-q01-welcome",
    "q02": "np-q02-toy-workshop",
    "q03": "np-q03-candy-cane-forest",
    "q04": "np-q04-frozen-lake",
    "q05": "np-q05-missing-reindeer",
    "q06": "np-q06-gingerbread-mystery",
    "q07": "np-q07-snowflake-mountain",
    "q08": "np-q08-restore-the-star",
    "q09": "np-q09-christmas-eve",
}

SNOWBALL_FOUND = "NORTH_POLE_SNOWBALL_FOUND"
SNOWBALL_HOME = "NORTH_POLE_SNOWBALL_HOME"
#: Where Snowball rests when the Area has no `np-snowball-stable` placement: inside the stables
#: zone (x 26..66, z 8..34 in the contract).
SNOWBALL_STABLE_FALLBACK = (46.0, 20.0)
SNOWBALL_STABLE_ENTITY = "np-snowball-stable"

CLIPS = ("Idle", "Walk", "Talk", "Wave", "Point", "Celebrate", "ReactHappy", "ReactConcerned")
ANIMATION_MAP = {
    "idle": "Idle",
    "walk": "Walk",
    "talk": "Talk",
    "wave": "Wave",
    "point": "Point",
    "celebrate": "Celebrate",
    "laugh": "ReactHappy",
    "sad": "ReactConcerned",
}
SNOWBALL_CLIPS = ("Idle", "Walk", "Run", "Jump")
SNOWBALL_ANIMATION_MAP = {"idle": "Idle", "walk": "Walk", "run": "Run", "jump": "Jump"}

_REACTIONS = {
    "adventure.started": "wave",
    "adventure.resumed": "wave",
    "answer.correct": "laugh",
    "answer.incorrect": "sad",
    "quest.completed": "celebrate",
    "adventure.completed": "celebrate",
}

#: Three lines for one text: Sprouts, Pathfinders, Explorers (in that order).
Bands = tuple[str, str, str]


@dataclass(frozen=True)
class Spot:
    key: str
    #: The Area's NPC `WorldObjectPlacement` entity id this spot is derived from.
    entity_id: str
    behavior: str
    spawn_conditions: tuple[dict, ...] = ()
    #: Used only when the Area has no placement with `entity_id` (None: skip the spot).
    fallback: tuple[float, float] | None = None


@dataclass(frozen=True)
class Offer:
    quest_id: str
    prerequisite_key: str | None  # None: offered from the start
    ask: Bands
    accept: str
    active: str


@dataclass(frozen=True)
class NorthPoleNpc:
    npc_id: str
    name: str
    role: str
    zone: str
    asset_id: str
    behaviors: dict
    spots: tuple[Spot, ...]
    personality: dict
    ai_mode: str  # "AUTHORED" or "HYBRID"
    #: Polly voice, language, engine, speaking rate percent; None: no voice (captions only).
    voice: tuple[str, str, str, int] | None
    persona_prompt: str
    persona_topics: tuple[str, ...]
    fallback_lines: tuple[str, ...]
    greet: Bands
    help_line: str
    hint: Bands
    thanks_key: str
    thanks_line: str
    return_line: str
    fallback_line: str
    offers: tuple[Offer, ...] = ()
    asset_category: str = "npc"
    clips: tuple[str, ...] = CLIPS
    animation_map: dict = field(default_factory=lambda: dict(ANIMATION_MAP))
    max_response_chars: int = 100

    @property
    def hint_topic(self) -> str:
        return self.persona_topics[0]


def _stationary(key: str, name: str) -> dict:
    return {
        key: {
            "display_name": name,
            "type": BehaviorType.STATIONARY,
            "parameters": {"facePlayer": True, "reactions": dict(_REACTIONS)},
        }
    }


def _wander(key: str, name: str, radius: float = 2.0) -> dict:
    return {
        key: {
            "display_name": name,
            "type": BehaviorType.WANDER,
            "parameters": {
                "radius": radius,
                "speed": 0.6,
                "pauseSeconds": [3, 6],
                "boundsRadius": radius + 2,
                "reactions": dict(_REACTIONS),
            },
        }
    }


_PERSONA_RULES = (
    " You are an AI-powered island character, never a person. Never ask for private "
    "information such as names, addresses, schools or photos. Never ask for secrets. Never "
    "give the puzzle answer. Use simple, warm, calm words and one or two short sentences."
)


def _world(key: str, present: bool = True) -> dict:
    return {"type": "WORLD_CHANGE", "key": key, "present": present}


NPCS: tuple[NorthPoleNpc, ...] = (
    NorthPoleNpc(
        npc_id="santa-claus",
        name="Santa Claus",
        role=NpcRole.QUEST_GIVER,
        zone="Santa's Landing",
        asset_id="north-pole-santa",
        behaviors=_stationary("np-santa-landing", "Santa at Santa's Landing"),
        spots=(Spot("np-santa", "np-santa", "np-santa-landing"),),
        personality={
            "traits": ["kind", "jolly", "grateful"],
            "tone": "warm",
            "catchphrases": ["Ho ho ho!"],
        },
        ai_mode="AUTHORED",
        voice=("Matthew", "en-US", "neural", 92),
        persona_prompt=(
            "Santa Claus is a kind, jolly folklore character at Santa's Landing who thanks "
            "children for helping the North Pole. The Christmas Star is island magic that "
            "helps his sleigh find its way." + _PERSONA_RULES
        ),
        persona_topics=("thanking helpers", "the sleigh and the Christmas Star"),
        fallback_lines=(
            "Ho ho ho! Thank you for helping the North Pole.",
            "The sleigh bell is by the sleigh. Give it a ring.",
            "Be kind and keep exploring.",
        ),
        greet=(
            "Ho ho ho! Hello, little helper!",
            "Ho ho ho! I am Santa Claus. Thank you for helping my elf friends.",
            "Ho ho ho! Welcome to Santa's Landing. I am Santa Claus. Thank you for all your "
            "help around the North Pole.",
        ),
        help_line="Come back any time. The whole North Pole is yours to explore.",
        hint=(
            "The bell is by the sleigh.",
            "Look near the sleigh for a shiny bell.",
            "Walk over to the sleigh and look for the bell. Ring it when the Star is back.",
        ),
        thanks_key="NORTH_POLE_CHRISTMAS_EVE",
        thanks_line="The sleigh is flying! Thank you, friend. Happy Christmas Eve!",
        return_line="Ho ho ho! Welcome back to Santa's Landing.",
        fallback_line="Ho ho ho! Enjoy the North Pole.",
        offers=(
            Offer(
                QUESTS["q09"],
                "NORTH_POLE_STAR_RESTORED",
                (
                    "The Star shines! Will you ring my bell?",
                    "The Christmas Star shines again! Will you ring my sleigh bell?",
                    "The Christmas Star shines again, thanks to you! Tonight is Christmas Eve. "
                    "Will you ring my sleigh bell?",
                ),
                "Wonderful! The bell is by the sleigh.",
                "The sleigh bell is waiting by the sleigh.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="mrs-claus",
        name="Mrs. Claus",
        role=NpcRole.TEACHER,
        zone="Gingerbread Village",
        asset_id="north-pole-mrs-claus",
        behaviors=_stationary("np-mrs-claus-kitchen", "Mrs. Claus in the gingerbread kitchen"),
        spots=(Spot("np-mrs-claus", "np-mrs-claus", "np-mrs-claus-kitchen"),),
        personality={
            "traits": ["caring", "patient", "cheerful"],
            "tone": "warm",
            "catchphrases": ["Let us bake something lovely."],
        },
        ai_mode="HYBRID",
        voice=("Joanna", "en-US", "neural", 98),
        persona_prompt=(
            "Mrs. Claus is a warm folklore character who bakes gingerbread. She helps children "
            "read a recipe card and measure ingredients with care." + _PERSONA_RULES
        ),
        persona_topics=("reading a recipe card", "measuring ingredients", "baking gingerbread"),
        fallback_lines=(
            "Read the recipe slowly, one step at a time.",
            "Check each number before you choose.",
            "Take your time. Baking is not a race.",
        ),
        greet=(
            "Hello, dear! Let us bake cookies!",
            "Hello, dear! I am Mrs. Claus. Let us read the recipe and bake gingerbread.",
            "Hello, dear! I am Mrs. Claus. The gingerbread village needs a good recipe. Read "
            "the card with me and we will measure everything with care.",
        ),
        help_line="Read the recipe card first. Then measure each part with care.",
        hint=(
            "Look at the picture on the card.",
            "Read each step slowly. What comes first?",
            "Read the whole recipe first. Check the numbers and the units before you choose.",
        ),
        thanks_key="NORTH_POLE_GINGER_REPAIRED",
        thanks_line="Lovely work, dear! The village looks wonderful.",
        return_line="Welcome back, dear! The kitchen smells wonderful.",
        fallback_line="Hello, dear! Would you like a cookie?",
    ),
    NorthPoleNpc(
        npc_id="jingle",
        name="Jingle",
        role=NpcRole.GUIDE,
        zone="Santa's Landing and Snowflake Mountain base",
        asset_id="north-pole-elf-jingle",
        behaviors={
            **_stationary("np-jingle-landing", "Jingle at Santa's Landing"),
            **_stationary("np-jingle-mountain", "Jingle at the mountain base"),
        },
        spots=(
            Spot("np-jingle", "np-jingle", "np-jingle-landing"),
            Spot("np-jingle-mountain", "np-jingle-mountain", "np-jingle-mountain"),
        ),
        personality={
            "traits": ["cheerful", "energetic", "encouraging"],
            "tone": "cheerful",
            "catchphrases": ["Jingle jingle!"],
        },
        ai_mode="HYBRID",
        voice=("Ivy", "en-US", "neural", 106),
        persona_prompt=(
            "Jingle is a cheerful elf helper who greets children at Santa's Landing and teaches "
            "them to move, look, jump and collect star pieces. The Christmas Star is island "
            "magic." + _PERSONA_RULES
        ),
        persona_topics=(
            "moving, looking and jumping",
            "finding star pieces",
            "the North Pole village",
        ),
        fallback_lines=(
            "Look around for something shiny.",
            "Walk up close to pick things up.",
            "Take your time. We will find the Star together.",
        ),
        greet=(
            "Hi! I am Jingle, an elf. Let us find the Christmas Star!",
            "Hello! I am Jingle, an elf helper. The Christmas Star broke into seven pieces. "
            "Will you help me find them?",
            "Welcome to the North Pole! I am Jingle, an elf helper. A winter storm scattered "
            "the Christmas Star into seven pieces. The Star is island magic that helps Santa's "
            "sleigh find its way. Let us walk, look, jump and collect them.",
        ),
        help_line="Walk, look around and jump over small bumps. Pick up the shiny star pieces.",
        hint=(
            "Look for something shiny. Walk up to it.",
            "Look around for shiny star pieces. Walk close to pick one up.",
            "Turn slowly and look for a glow. Star pieces can be up high, so look for steps "
            "or a ramp that leads there.",
        ),
        thanks_key="NORTH_POLE_MOUNTAIN_SUMMIT",
        thanks_line="You did it! You climbed the whole mountain. Thank you!",
        return_line="Welcome back! The North Pole is waiting for you.",
        fallback_line="Hello! Let us find the Star together.",
        offers=(
            Offer(
                QUESTS["q01"],
                None,
                (
                    "Will you help me find the Star?",
                    "Will you help me find the seven star pieces?",
                    "Will you help me find the seven pieces of the Christmas Star? We will visit "
                    "many friends on the way.",
                ),
                "Hooray! Let us start in the village.",
                "Look around the village for the shiny star piece.",
            ),
            Offer(
                QUESTS["q07"],
                "NORTH_POLE_GINGER_REPAIRED",
                (
                    "Up the mountain! Will you come?",
                    "Snowflake Mountain is next. Will you climb it with me?",
                    "The last star piece is on top of Snowflake Mountain. The path has bridges, "
                    "so we will go slowly. Will you climb it with me?",
                ),
                "Great! Take your time on the bridges.",
                "Cross the bridges slowly. The summit is at the top.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="tinker",
        name="Tinker",
        role=NpcRole.QUEST_GIVER,
        zone="Santa's Workshop",
        asset_id="north-pole-elf-tinker",
        behaviors=_wander("np-tinker-bench", "Tinker at the workbench", 1.5),
        spots=(Spot("np-tinker", "np-tinker", "np-tinker-bench"),),
        personality={
            "traits": ["clever", "busy", "friendly"],
            "tone": "cheerful",
            "catchphrases": ["Click, clack, fixed!"],
        },
        ai_mode="HYBRID",
        voice=("Justin", "en-US", "neural", 104),
        persona_prompt=(
            "Tinker is a clever elf toymaker who likes counting, sorting and patterns. Tinker "
            "gives one short, gentle hint about the toy workshop." + _PERSONA_RULES
        ),
        persona_topics=("counting toys", "sorting and patterns", "putting a toy together"),
        fallback_lines=(
            "Touch each toy and count out loud.",
            "Look for what repeats. What comes next?",
            "Do one step at a time.",
        ),
        greet=(
            "Hi! I am Tinker. Let us count toys!",
            "Hello! I am Tinker, the toymaker. The toy machine has stopped. Can you help?",
            "Welcome to the toy workshop! I am Tinker. The toy machine has stopped and the "
            "presents are all mixed up. We can count, sort and fix it together.",
        ),
        help_line="Count the toys, sort the presents, then build the toy in order.",
        hint=(
            "Touch each toy. Say one number each.",
            "Count each toy one by one. Do not skip any.",
            "Look for what repeats on the belt. What comes next?",
        ),
        thanks_key="NORTH_POLE_WORKSHOP_RESTORED",
        thanks_line="The machine hums again! Thank you, friend!",
        return_line="Welcome back to the workshop!",
        fallback_line="Hello! Mind the toys on the floor.",
        offers=(
            Offer(
                QUESTS["q02"],
                "NORTH_POLE_WELCOME_LOOKED",
                (
                    "The machine is stuck. Will you help?",
                    "The toy machine is stuck. Will you help me fix it?",
                    "The toy machine is stuck, and the toys need counting and sorting. Will you "
                    "help me fix it?",
                ),
                "Wonderful! Start with the toys on the belt.",
                "Count the toys first, then sort the presents.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="peppermint",
        name="Peppermint",
        role=NpcRole.GUIDE,
        zone="Candy Cane Forest",
        asset_id="north-pole-elf-peppermint",
        behaviors=_wander("np-peppermint-trail", "Peppermint on the candy trail", 2.5),
        spots=(Spot("np-peppermint", "np-peppermint", "np-peppermint-trail"),),
        personality={
            "traits": ["sweet", "playful", "curious"],
            "tone": "cheerful",
            "catchphrases": ["Stripes and swirls!"],
        },
        ai_mode="HYBRID",
        voice=("Salli", "en-US", "neural", 104),
        persona_prompt=(
            "Peppermint is a playful elf who loves candy canes. Peppermint helps children follow "
            "number sequences, read signs and match candy stripe patterns." + _PERSONA_RULES
        ),
        persona_topics=("number sequences", "reading signs", "candy stripe patterns"),
        fallback_lines=(
            "Say the numbers out loud.",
            "Look at the stripes. What comes next?",
            "Read the sign slowly.",
        ),
        greet=(
            "Hi! I am Peppermint. I love candy canes!",
            "Hello! I am Peppermint. Follow the candy cane trail with me.",
            "Welcome to the Candy Cane Forest! I am Peppermint. The trail has numbers, signs "
            "and stripes to follow.",
        ),
        help_line="Read the signs, follow the numbers and match the stripes.",
        hint=(
            "Look at the stripes. Red, white, red, white.",
            "Say the numbers out loud. What is the next one?",
            "Find the rule. Does each number go up by the same amount?",
        ),
        thanks_key="NORTH_POLE_FOREST_DONE",
        thanks_line="The trail is tidy again! Thank you!",
        return_line="Welcome back to the forest!",
        fallback_line="Hello! Smell that candy cane air?",
        offers=(
            Offer(
                QUESTS["q03"],
                "NORTH_POLE_WORKSHOP_RESTORED",
                (
                    "Will you follow the trail?",
                    "Will you follow the candy cane trail with me?",
                    "The trail is tangled. Will you help me follow the signs and numbers to the "
                    "end?",
                ),
                "Yay! Let us follow the stripes.",
                "Follow the signs and the numbers along the trail.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="frosty",
        name="Frosty",
        role=NpcRole.GUIDE,
        zone="Frozen Lake",
        asset_id="north-pole-elf-frosty",
        behaviors=_wander("np-frosty-shore", "Frosty skating by the shore", 2.5),
        spots=(Spot("np-frosty", "np-frosty", "np-frosty-shore"),),
        personality={
            "traits": ["sporty", "friendly", "calm"],
            "tone": "cheerful",
            "catchphrases": ["Glide and smile!"],
        },
        ai_mode="HYBRID",
        voice=("Kevin", "en-US", "neural", 100),
        persona_prompt=(
            "Frosty is an elf who ice skates on the Frozen Lake. Frosty is an elf, never a "
            "snowman. Facts start with 'Real ice'. Frosty helps children with sums on ice "
            "floes, number order, shapes and fractions." + _PERSONA_RULES
        ),
        persona_topics=("real ice and water", "numbers on ice floes", "shapes and fractions"),
        fallback_lines=(
            "Do the sum first. Then look for the floe.",
            "Put the numbers in order, small to big.",
            "Real ice is water that got very cold.",
        ),
        greet=(
            "Hi! I am Frosty, an elf. I skate on ice!",
            "Hello! I am Frosty, an elf who skates. Real ice is frozen water. Let us cross "
            "the lake.",
            "Welcome to the Frozen Lake! I am Frosty, an elf skater. Real ice is water that "
            "got so cold it froze. Let us cross the lake using numbers and shapes.",
        ),
        help_line="Pick the ice floe with the right answer. Then put the floes in order.",
        hint=(
            "Count the dots on each floe.",
            "Work out the sum first. Then find that floe.",
            "Do the sum in your head. Then check the number on the floe.",
        ),
        thanks_key="NORTH_POLE_LAKE_DONE",
        thanks_line="You crossed the lake! Thank you, friend!",
        return_line="Welcome back to the lake!",
        fallback_line="Hello! The ice is smooth today.",
        offers=(
            Offer(
                QUESTS["q04"],
                "NORTH_POLE_FOREST_DONE",
                (
                    "Will you cross the lake with me?",
                    "The ice bridge is missing. Will you help me cross the lake?",
                    "The ice bridge is missing, and the floes need the right answers. Will you "
                    "help me cross the lake?",
                ),
                "Great! Step on the right floe.",
                "Step on the floe with the right answer.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="noel",
        name="Noel",
        role=NpcRole.QUEST_GIVER,
        zone="Reindeer Stables and Pine Hollow",
        asset_id="north-pole-elf-noel",
        behaviors=_stationary("np-noel-stables", "Noel at the stables"),
        spots=(Spot("np-noel", "np-noel", "np-noel-stables"),),
        personality={
            "traits": ["gentle", "caring", "patient"],
            "tone": "calm",
            "catchphrases": ["Easy now, friends."],
        },
        ai_mode="HYBRID",
        voice=("Brian", "en-GB", "neural", 98),
        persona_prompt=(
            "Noel is a gentle elf who looks after the reindeer. Facts start with 'Real "
            "reindeer'. Noel helps children learn about reindeer, follow footprints and decide "
            "what reindeer need." + _PERSONA_RULES
        ),
        persona_topics=("real reindeer facts", "footprints and tracks", "what reindeer eat"),
        fallback_lines=(
            "Look closely at the footprints.",
            "Real reindeer have wide hooves for walking on snow.",
            "Be gentle and go slowly near the reindeer.",
        ),
        greet=(
            "Hi! I am Noel. I look after the reindeer.",
            "Hello! I am Noel. Real reindeer have wide hooves for snow. A calf named Snowball "
            "is lost.",
            "Welcome to the stables! I am Noel, the reindeer keeper. Real reindeer grow new "
            "antlers every year and have wide hooves for walking on snow. A calf named "
            "Snowball is lost in Pine Hollow.",
        ),
        help_line="Learn about reindeer, follow the tracks, then bring Snowball home.",
        hint=(
            "Look at the footprints. Which way do they go?",
            "Small prints are a calf. Follow them to the end.",
            "Compare the size of the prints. Then follow the biggest set of fresh tracks.",
        ),
        thanks_key=SNOWBALL_HOME,
        thanks_line="Snowball is home! Thank you, friend!",
        return_line="Welcome back to the stables!",
        fallback_line="Hello! The reindeer are resting.",
        offers=(
            Offer(
                QUESTS["q05"],
                "NORTH_POLE_LAKE_DONE",
                (
                    "Snowball is lost. Will you help?",
                    "A reindeer calf named Snowball is lost. Will you help me find the calf?",
                    "A reindeer calf named Snowball wandered off into Pine Hollow. Will you "
                    "help me learn about reindeer and find the calf?",
                ),
                "Thank you! Start with the reindeer facts.",
                "Learn about reindeer, follow the tracks, and find Snowball in Pine Hollow.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="ginger",
        name="Ginger",
        role=NpcRole.QUEST_GIVER,
        zone="Gingerbread Village",
        asset_id="north-pole-elf-ginger",
        behaviors=_wander("np-ginger-street", "Ginger on the gingerbread street", 2.0),
        spots=(Spot("np-ginger", "np-ginger", "np-ginger-street"),),
        personality={
            "traits": ["artistic", "careful", "kind"],
            "tone": "warm",
            "catchphrases": ["Every shape fits somewhere."],
        },
        ai_mode="HYBRID",
        voice=("Emma", "en-GB", "neural", 100),
        persona_prompt=(
            "Ginger is a careful elf who builds gingerbread houses. Ginger helps children match "
            "shapes, finish symmetric patterns and measure." + _PERSONA_RULES
        ),
        persona_topics=("shapes and symmetry", "measuring", "building with cookie pieces"),
        fallback_lines=(
            "Look at the shape. How many sides does it have?",
            "Both sides should look the same.",
            "Measure twice, then choose.",
        ),
        greet=(
            "Hi! I am Ginger. Look at my cookie houses!",
            "Hello! I am Ginger. Some of the gingerbread houses are broken. Can you help me "
            "fix them?",
            "Welcome to the Gingerbread Village! I am Ginger. Something is wrong with the "
            "houses. We can match shapes, finish the windows and measure to fix them.",
        ),
        help_line="Match the shapes, finish the window pattern, then build the wall.",
        hint=(
            "Look at the shapes. Which one matches?",
            "Look at the window. Both sides should match.",
            "Fold the picture in your mind. Does each side match the other?",
        ),
        thanks_key="NORTH_POLE_GINGER_REPAIRED",
        thanks_line="The village is fixed! Thank you, friend!",
        return_line="Welcome back to the village!",
        fallback_line="Hello! Do not nibble the houses.",
        offers=(
            Offer(
                QUESTS["q06"],
                SNOWBALL_HOME,
                (
                    "The houses are broken. Will you help?",
                    "Some gingerbread houses are broken. Will you help me fix them?",
                    "Something is wrong with the gingerbread village. Will you help me find out "
                    "what, and fix it?",
                ),
                "Thank you! Let us start with the shapes.",
                "Match the shapes, then fix the wall.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="polaris",
        name="Polaris",
        role=NpcRole.TEACHER,
        zone="North Pole Observatory",
        asset_id="north-pole-elf-polaris",
        behaviors=_stationary("np-polaris-telescope", "Polaris at the telescope"),
        spots=(Spot("np-polaris", "np-polaris", "np-polaris-telescope"),),
        personality={
            "traits": ["thoughtful", "calm", "curious"],
            "tone": "calm",
            "catchphrases": ["Real stars are amazing."],
        },
        ai_mode="HYBRID",
        voice=("Amy", "en-GB", "neural", 96),
        persona_prompt=(
            "Polaris is a calm elf astronomer. Facts start with 'Real stars'. The Christmas "
            "Star is island magic, not a real star. Polaris helps children learn about the "
            "night sky and put the star pieces back together." + _PERSONA_RULES
        ),
        persona_topics=(
            "real stars and the night sky",
            "constellations",
            "putting the Christmas Star together",
        ),
        fallback_lines=(
            "Real stars are very far away.",
            "Think about where you went first.",
            "Look at the sky and take your time.",
        ),
        greet=(
            "Hello! I am Polaris. I study the stars!",
            "Hello! I am Polaris, an astronomer. Real stars are giant balls of hot gas, very "
            "far away. Let us fix the Christmas Star.",
            "Welcome to the observatory. I am Polaris, an astronomer. Real stars are giant "
            "balls of hot gas, very far away. The Christmas Star is island magic, and it helps "
            "Santa's sleigh find its way. Let us put it back together.",
        ),
        help_line="Learn about the stars, then set the seven pieces in the order of your trip.",
        hint=(
            "Think about where you went first.",
            "Remember your trip. Which place came first?",
            "Put the pieces in the order you found them, from the village to the mountain.",
        ),
        thanks_key="NORTH_POLE_STAR_RESTORED",
        thanks_line="The Star shines again! Thank you, friend!",
        return_line="Welcome back to the observatory!",
        fallback_line="Hello! The sky is clear tonight.",
        offers=(
            Offer(
                QUESTS["q08"],
                "NORTH_POLE_MOUNTAIN_SUMMIT",
                (
                    "Will you help fix the Star?",
                    "We have all seven pieces. Will you help me fix the Star?",
                    "You found all seven pieces! Will you help me learn about the night sky and "
                    "put the Christmas Star back together?",
                ),
                "Wonderful! Let us look at the stars first.",
                "Learn about the stars, then place the seven pieces.",
            ),
        ),
    ),
    NorthPoleNpc(
        npc_id="snowball",
        name="Snowball",
        role=NpcRole.COMPANION,
        zone="Pine Hollow and the Reindeer Stables",
        asset_id="north-pole-reindeer-calf",
        asset_category="creature",
        clips=SNOWBALL_CLIPS,
        animation_map=dict(SNOWBALL_ANIMATION_MAP),
        behaviors={
            "np-snowball-lost": {
                "display_name": "Snowball waits in Pine Hollow",
                "type": BehaviorType.STATIONARY,
                "parameters": {"facePlayer": True, "reactions": {}},
            },
            "np-snowball-follow": {
                "display_name": "Snowball follows the child",
                "type": BehaviorType.FOLLOW,
                "parameters": {
                    "stopDistance": 2,
                    "speed": 3,
                    "giveUpDistance": 40,
                    "boundsRadius": 100,
                    "reactions": {},
                },
            },
            "np-snowball-rest": {
                "display_name": "Snowball rests in the stable",
                "type": BehaviorType.STATIONARY,
                "parameters": {"facePlayer": True, "reactions": {}},
            },
        },
        spots=(
            Spot(
                "np-snowball-lost",
                "np-snowball",
                "np-snowball-lost",
                (_world(SNOWBALL_FOUND, False),),
            ),
            Spot(
                "np-snowball-follow",
                "np-snowball",
                "np-snowball-follow",
                (_world(SNOWBALL_FOUND), _world(SNOWBALL_HOME, False)),
            ),
            Spot(
                "np-snowball-home",
                SNOWBALL_STABLE_ENTITY,
                "np-snowball-rest",
                (_world(SNOWBALL_HOME),),
                fallback=SNOWBALL_STABLE_FALLBACK,
            ),
        ),
        personality={
            "traits": ["shy", "gentle", "curious"],
            "tone": "soft",
            "catchphrases": ["Snuffle snuffle."],
        },
        ai_mode="AUTHORED",
        voice=None,
        persona_prompt=(
            "Snowball is a small reindeer calf who does not speak. Snowball is shown with short "
            "captions about snuffles, nuzzles and hops." + _PERSONA_RULES
        ),
        persona_topics=("being a friendly reindeer calf",),
        fallback_lines=(
            "Snowball snuffles softly.",
            "Snowball nuzzles your hand.",
            "Snowball hops in the snow.",
        ),
        greet=("", "", ""),  # Snowball uses the three state dialogues below instead
        help_line="",
        hint=("", "", ""),
        thanks_key=SNOWBALL_HOME,
        thanks_line="",
        return_line="Snowball looks up and snuffles hello.",
        fallback_line="Snowball snuffles softly.",
    ),
)

NPC_IDS = tuple(npc.npc_id for npc in NPCS)

#: Voice-less characters never get a profile; every other character's profile id is its npc id.
VOICED_NPC_IDS = tuple(npc.npc_id for npc in NPCS if npc.voice is not None)

#: (npc id, quest id) for every OFFER_QUEST choice.
QUEST_OFFERS = tuple((npc.npc_id, offer.quest_id) for npc in NPCS for offer in npc.offers)

REQUIRED_BEHAVIOURS: dict[str, tuple[str, ...]] = {
    "greet": ("on_interact",),
    "return_visit": ("on_return_visit",),
    "fallback": ("on_interact",),
}


def _age(band: str) -> dict:
    return {"type": "AGE_BAND", "in": [band]}


def _quest_status(quest_id: str, status: str) -> dict:
    return {"type": "QUEST_STATUS", "quest": quest_id, "status": status}


def dialogues(npc: NorthPoleNpc) -> tuple[Dialogue, ...]:
    """One character's dialogues: age-banded greeting, offers and hints, thanks, fallback."""
    if npc.npc_id == "snowball":
        return _snowball_dialogues(npc)
    hybrid = npc.ai_mode == "HYBRID"
    result: list[Dialogue] = [
        Dialogue(
            "thanks",
            "After the zone is done",
            "on_interact",
            (Node("thanks", npc.thanks_line, emotion="proud", animation="celebrate"),),
            priority=50,
            conditions=(_world(npc.thanks_key),),
            behaviour="greet",
        )
    ]
    for offer in npc.offers:
        slug = offer.quest_id
        extra = (_world(offer.prerequisite_key),) if offer.prerequisite_key else ()
        result.append(
            Dialogue(
                f"active-{slug}",
                f"Reminder while {slug} is active",
                "on_interact",
                (Node("reminder", offer.active, emotion="curious", animation="point"),),
                priority=25,
                conditions=(_quest_status(slug, "ACTIVE"),),
                behaviour="greet",
            )
        )
        for index, band in enumerate(BAND_ORDER):
            result.append(
                Dialogue(
                    f"offer-{slug}-{band.lower()}",
                    f"Offer {slug} for {band.title()}s",
                    "on_interact",
                    (
                        Node(
                            "ask",
                            offer.ask[index],
                            emotion="curious",
                            animation="talk",
                            choices=(
                                Choice(
                                    "yes",
                                    "Yes, I will help!",
                                    next="accepted",
                                    action="OFFER_QUEST",
                                    value=slug,
                                ),
                                Choice("later", "Maybe later", action="END"),
                            ),
                        ),
                        Node("accepted", offer.accept, emotion="excited", animation="wave"),
                    ),
                    priority=30,
                    conditions=(*extra, _quest_status(slug, "NOT_STARTED"), _age(band)),
                    behaviour="greet",
                )
            )
    for index, band in enumerate(BAND_ORDER):
        result.append(
            Dialogue(
                f"greeting-{band.lower()}",
                f"Greeting for {band.title()}s",
                "on_interact",
                (
                    Node(
                        "welcome",
                        npc.greet[index],
                        emotion="happy",
                        animation="wave",
                        choices=(
                            Choice("more", "Tell me more", next="help"),
                            Choice("bye", "Bye for now", action="END"),
                        ),
                    ),
                    Node("help", npc.help_line, emotion="curious", animation="point"),
                ),
                priority=20,
                conditions=(_age(band),),
                behaviour="greet",
            )
        )
        result.append(_hint_dialogue(npc, band, index, hybrid))
    result += [
        Dialogue(
            "welcome-back",
            "A returning explorer",
            "on_return_visit",
            (Node("again", npc.return_line, animation="wave"),),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="return_visit",
        ),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (Node("hello", npc.fallback_line, animation="wave"),),
            priority=0,
            behaviour="fallback",
        ),
    ]
    return tuple(result)


def _hint_dialogue(npc: NorthPoleNpc, band: str, index: int, hybrid: bool) -> Dialogue:
    """A hint after a wrong answer. Only the hint node may ask the AI, and only for HYBRID."""
    hint = Node(
        "hint",
        npc.hint[index],
        emotion="thinking",
        animation="talk",
        allow_ai_hint=hybrid,
        allowed_topic=npc.hint_topic if hybrid else "",
    )
    if hybrid:
        retry = Node(
            "try-again",
            "Not quite yet. Let us try again!",
            emotion="thinking",
            animation="think",
            choices=(
                Choice("help-me", "Help me", next="hint", action="REQUEST_HINT"),
                Choice("thanks", f"Thanks, {npc.name}", action="END"),
            ),
        )
    else:
        retry = Node(
            "try-again",
            "Not quite yet. Let us try again!",
            emotion="thinking",
            animation="talk",
            next="hint",
        )
    return Dialogue(
        f"hint-{band.lower()}",
        f"Hint after a wrong answer for {band.title()}s",
        "on_incorrect_answer",
        (retry, hint),
        priority=0,
        conditions=(_age(band),),
        behaviour="hint",
    )


def _snowball_dialogues(npc: NorthPoleNpc) -> tuple[Dialogue, ...]:
    def line(key: str, title: str, text: str, priority: int, conds, emotion="happy") -> Dialogue:
        return Dialogue(
            key,
            title,
            "on_interact",
            (Node("snuffle", text, emotion=emotion, animation="idle"),),
            priority=priority,
            conditions=tuple(conds),
            behaviour="greet",
        )

    return (
        line(
            "snowball-lost",
            "Lost in Pine Hollow",
            "Snowball is shivering and looks lost. A little collar lies in the snow.",
            30,
            [_world(SNOWBALL_FOUND, False)],
            "sad",
        ),
        line(
            "snowball-following",
            "Following the child",
            "Snowball hops along beside you. Let us go home.",
            30,
            [_world(SNOWBALL_FOUND), _world(SNOWBALL_HOME, False)],
            "happy",
        ),
        line(
            "snowball-home",
            "Resting in the stable",
            "Snowball is warm and snug in the stable. Snuffle snuffle.",
            30,
            [_world(SNOWBALL_HOME)],
            "proud",
        ),
        Dialogue(
            "welcome-back",
            "A returning explorer",
            "on_return_visit",
            (Node("again", npc.return_line, animation="idle"),),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="return_visit",
        ),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (Node("hello", npc.fallback_line, animation="idle"),),
            priority=0,
            behaviour="fallback",
        ),
    )

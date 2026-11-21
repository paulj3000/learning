"""North Pole Village puzzle content (NP-005, NP-024, NP-043): pure data, no ORM.

`PUZZLES` holds one puzzle body per puzzle in contract order (docs/north-pole/NORTH_POLE_DESIGN.md
section 5), each in the shape `seeding.seed_puzzle` and `puzzles.body_problems` accept, with all
three age bands (SPROUT, PATHFINDER, EXPLORER). `ENTITY_IDS` names the placements each puzzle
binds (the layout workstream uses the same ids) and `ENTITY_MAPS` records the option and item
maps so both workstreams can reconcile.

Arithmetic variants are produced by `_Vs.a`, which computes the correct option from the operands
and records them in `ARITHMETIC`, so a test can recompute every answer independently. Wrong
options are plausible slips (off by one, adding instead of multiplying), never nonsense.

Copy rules: prompts are readable aloud, localizable, calm (no timers, no fear), contain no em
dashes, and explanations say why an answer works. Nothing here is religious. NPC speech lives in
dialogue, not here (puzzles.MOVED_TO_DIALOGUE).
"""

import json
from pathlib import Path

from apps.regions.models import PuzzleKind

from . import north_pole_layout as layout

BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")
REGION_ID = "north-pole-village"
CYCLE = ("circle", "square", "triangle", "star")

# --- arithmetic helpers ----------------------------------------------------------------------

OPS = {
    "id": lambda a: a,
    "add": lambda a, b: a + b,
    "sub": lambda a, b: a - b,
    "mul": lambda a, b: a * b,
    "div": lambda a, b: a // b if a % b == 0 else None,
    "sub3": lambda a, b, c: a - b - c,
    "mulsub": lambda a, b, c: a * b - c,
    "addmul": lambda a, b, c: a + b * c,
    "divsub": lambda a, b, c: a // b - c if a % b == 0 else None,
    "submul": lambda a, b, c: a - b * c,
}
# (puzzleId, band, variantId) -> (op, args): lets a test recompute each generated answer.
ARITHMETIC: dict[tuple[str, str, str], tuple[str, tuple[int, ...]]] = {}


def _near(correct, *, extra=(), deltas=(1, -1, 2, -2, 10, -10), lo=0, hi=999, n=2):
    """Plausible wrong numbers: the given slips first, then near misses."""
    out: list[int] = []
    for value in [*extra, *(correct + d for d in deltas)]:
        if lo <= value <= hi and value != correct and value not in out:
            out.append(value)
        if len(out) == n:
            break
    return [str(v) for v in out]


class _Vs:
    """Collects the variants of one puzzle for one band."""

    def __init__(self, pid: str, band: str, wrongs: int | None = None):
        self.pid, self.band = pid, band
        self.nw = (
            wrongs if wrongs is not None else {"SPROUT": 2, "PATHFINDER": 2, "EXPLORER": 3}[band]
        )
        self.variants: list[dict] = []

    def _vid(self) -> str:
        return f"v{len(self.variants) + 1}"

    def c(self, prompt, correct, wrongs, expl, syms=None):
        """A choice variant. The correct option rotates through the positions."""
        n = len(wrongs) + 1
        pos = len(self.variants) % n
        labels = list(wrongs)
        labels.insert(pos, correct)
        ids = "abcd"[:n]
        options = []
        for i, label in enumerate(labels):
            option = {"id": ids[i], "label": label}
            if self.band == "SPROUT":
                option["symbol"] = (syms or {}).get(label, CYCLE[i])
            options.append(option)
        self.variants.append(
            {
                "id": self._vid(),
                "prompt": prompt,
                "options": options,
                "answer": ids[pos],
                "explanation": expl,
            }
        )

    def a(
        self,
        op,
        args,
        prompt,
        expl,
        *,
        extra=(),
        deltas=(1, -1, 2, -2, 10, -10),
        lo=0,
        hi=999,
        **names,
    ):
        """An arithmetic choice variant: `{0}`, `{1}` in the prompt are the operands."""
        result = OPS[op](*args)
        assert result is not None, (self.pid, args)
        ARITHMETIC[(self.pid, self.band, self._vid())] = (op, tuple(args))
        wrongs = _near(result, extra=extra, deltas=deltas, lo=lo, hi=hi, n=self.nw)
        self.c(prompt.format(*args, **names), str(result), wrongs, expl.format(*args, r=result))

    def o(self, prompt, ordered, expl):
        """An order variant. `ordered` is [(item id, label)] in the correct order."""
        n = len(ordered)
        shown = list(reversed(ordered))
        k = len(self.variants) % n
        shown = shown[k:] + shown[:k]
        if shown == ordered:
            shown = shown[1:] + shown[:1]
        items = []
        for i, (item_id, label) in enumerate(shown):
            item = {"id": item_id, "label": label}
            if self.band == "SPROUT":
                item["symbol"] = CYCLE[i]
            items.append(item)
        self.variants.append(
            {
                "id": self._vid(),
                "prompt": prompt,
                "items": items,
                "answer": [item_id for item_id, _ in ordered],
                "explanation": expl,
            }
        )

    def lake(self, nums, prompt, expl, *, descending=False):
        """Floes a, b, c, (d) painted with `nums` in floe order; the answer sorts the numbers."""
        ids = "abcd"[: len(nums)]
        order = sorted(range(len(nums)), key=lambda i: nums[i], reverse=descending)
        assert [ids[i] for i in order] != list(ids), "already in order"
        items = [{"id": ids[i], "label": str(nums[i])} for i in range(len(nums))]
        if self.band == "SPROUT":
            for i, item in enumerate(items):
                item["symbol"] = CYCLE[i]
        self.variants.append(
            {
                "id": self._vid(),
                "prompt": prompt,
                "items": items,
                "answer": [ids[i] for i in order],
                "explanation": expl,
            }
        )


def _quiz(vs: _Vs, presentation, subject, skill, hints, **maps) -> dict:
    return {
        "presentation": presentation,
        "subject": subject,
        "skill": skill,
        **maps,
        "variants": vs.variants,
        "hints": hints,
        "hintAfterAttempts": 1 if vs.band == "SPROUT" else 2,
    }


CHOOSE, ORDER = PuzzleKind.CHOOSE_ANSWER, PuzzleKind.ORDER_SEQUENCE


# --- 2 np-workshop-count ---------------------------------------------------------------------


def _workshop_count(band):
    vs = _Vs("np-workshop-count", band)
    if band == "SPROUT":
        for n, things in (
            (3, "teddy bears"),
            (4, "toy drums"),
            (2, "toy trains"),
            (5, "balls"),
            (4, "dolls"),
        ):
            vs.a(
                "id",
                (n,),
                "Tinker lined up {0} "
                + things
                + " on the belt. How many "
                + things
                + " are there?",
                "Touch each one and say a number. The last number you say, {r}, tells how many "
                "there are.",
                lo=1,
                hi=5,
                deltas=(1, -1, 2, -2),
            )
        hints = [
            "Touch each toy one time and say a number.",
            "Start at one. The last number is the answer.",
        ]
    elif band == "PATHFINDER":
        for a, b, x, y in (
            (4, 3, "trains", "robots"),
            (5, 2, "drums", "bears"),
            (6, 3, "dolls", "kites"),
            (2, 7, "balls", "blocks"),
            (5, 4, "cars", "puzzles"),
        ):
            vs.a(
                "add",
                (a, b),
                "Tinker has {0} toy "
                + x
                + " and {1} toy "
                + y
                + " on the belt. How many toys is that in all?",
                "{0} and {1} together make {r}. Counting on from the bigger number is a quick way.",
                deltas=(1, -1, 2, -2),
            )
        hints = [
            "Start with the bigger number and count on.",
            "Use your fingers to count up from the first group.",
        ]
    else:
        for a, b, x, y in (
            (4, 3, "boxes", "toys"),
            (5, 2, "shelves", "robots"),
            (3, 6, "sacks", "dolls"),
            (6, 4, "crates", "puzzles"),
            (5, 5, "trays", "wooden horses"),
            (2, 8, "baskets", "balls"),
        ):
            vs.a(
                "mul",
                (a, b),
                "Tinker packs {0} "
                + x
                + " with {1} "
                + y
                + " in each one. How many "
                + y
                + " is that in all?",
                "{0} equal groups of {1} make {0} x {1} = {r}. Adding {1} again and again gives "
                "the same total.",
                extra=(a + b,),
                deltas=(b, -b, 1, -1),
            )
        hints = [
            "Each group is the same size. Count the groups, then count the toys in one group.",
            "Try adding the group size again and again: for example 3 + 3 + 3.",
        ]
    return _quiz(
        vs,
        "CARDS",
        "MATHEMATICS",
        {
            "SPROUT": "counting-sets",
            "PATHFINDER": "addition-within-ten",
            "EXPLORER": "multiplication-facts",
        }[band],
        hints,
    )


# --- 3 np-workshop-sort ----------------------------------------------------------------------


def _workshop_sort(band):
    vs = _Vs("np-workshop-sort", band)
    if band == "SPROUT":
        shapes = {"Round ball": "circle", "Square box": "square", "Triangle tent": "triangle"}
        vs.c(
            "Which present is round like a ball?",
            "Round ball",
            ["Square box", "Triangle tent"],
            "A ball is round all the way around, like a circle.",
            shapes,
        )
        vs.c(
            "Which present is shaped like a square?",
            "Square box",
            ["Round ball", "Triangle tent"],
            "A square has four sides that are the same length. The box has that shape.",
            shapes,
        )
        vs.c(
            "Which present is yellow, like a banana?",
            "Yellow present",
            ["Red present", "Blue present"],
            "Bananas are yellow, and so is this present. Colours help us sort.",
        )
        vs.c(
            "Which teddy is the big one?",
            "Big teddy",
            ["Small teddy"],
            "The big teddy takes up more room than the small one.",
        )
        vs.c(
            "Which of these can you play with?",
            "Toy drum",
            ["Wooden spoon", "Warm sock"],
            "A drum is a toy. Toys are things we play with.",
        )
        hints = [
            "Look at the picture on each card.",
            "Think about the shape or colour in the question.",
        ]
    elif band == "PATHFINDER":
        vs.c(
            "Tinker is making a red pile: a red ball, a red drum, a blue train. Which one does not "
            "belong in the red pile?",
            "Blue train",
            ["Red ball", "Red drum"],
            "The blue train is a different colour, so it goes in the blue pile.",
        )
        vs.c(
            "Tinker sorts toys that roll: a ball, a wheel, a toy block. Which does not roll well?",
            "Toy block",
            ["Ball", "Wheel"],
            "A block has flat sides, so it slides or tumbles. Balls and wheels are round, so they "
            "roll.",
        )
        vs.c(
            "Which one is not a toy: a teddy bear, a toy robot, a snow shovel?",
            "Snow shovel",
            ["Teddy bear", "Toy robot"],
            "A shovel is a tool for moving snow. The bear and the robot are toys.",
        )
        vs.c(
            "Tinker makes a pile of circles: a clock face, a coin, a book. Which does not belong "
            "in the circle pile?",
            "Book",
            ["Clock face", "Coin"],
            "A book is a rectangle. The clock face and the coin are round like circles.",
        )
        vs.c(
            "Tinker sorts by size. Big: a drum, a sleigh. Small: a button, a bell. Where does a "
            "wooden horse go?",
            "With the big things",
            ["With the small things", "In neither pile"],
            "A wooden horse is about as big as a drum or a sleigh, so it joins the big pile.",
        )
        hints = [
            "Find the two that are the same in some way.",
            "Say what the group has in common, then look for the one that is different.",
        ]
    else:
        vs.c(
            "Tinker sorts toys by what they are made of: wood, cloth or metal. A teddy bear is "
            "soft and stuffed. Which pile does it go in?",
            "Cloth",
            ["Wood", "Metal", "Glass"],
            "A teddy bear is made of soft cloth and stuffing, so it goes in the cloth pile.",
        )
        vs.c(
            "Presents: red circle, blue circle, red square, blue square. Tinker needs one that is "
            "red AND a square. Which present?",
            "Red square",
            ["Red circle", "Blue square", "Blue circle"],
            "It must be both red and a square. Only the red square has both.",
        )
        vs.c(
            "Tinker has: a toy fire truck, a toy train, a toy boat, a toy kite. Which one travels "
            "in the air?",
            "Toy kite",
            ["Toy fire truck", "Toy train", "Toy boat"],
            "Kites fly in the air. Trucks and trains go on land and boats go on water.",
        )
        vs.c(
            "A pile has these toys: marbles, a ball, an orange, a coin. Tinker sorts by shape. "
            "Which toy is not round like a sphere?",
            "Coin",
            ["Marbles", "Ball", "Orange"],
            "A coin is flat like a circle, not a ball. Marbles, balls and oranges are spheres.",
        )
        vs.c(
            "Tinker sorts into 'hard' and 'soft'. The hard pile has a wooden train and a metal "
            "robot. Which present goes in the soft pile?",
            "Fluffy scarf",
            ["Wooden block", "Metal bell", "Glass globe"],
            "A scarf bends and squishes, so it is soft. Wood, metal and glass are hard.",
        )
        hints = [
            "Say the rule out loud, then test each present.",
            "When there are two rules, look for the present that follows both.",
        ]
    return _quiz(vs, "SHAPES", "LOGIC", "classification", hints)


# --- 4 np-workshop-pattern -------------------------------------------------------------------


def _workshop_pattern(band):
    vs = _Vs("np-workshop-pattern", band)
    if band == "SPROUT":
        vs.c(
            "The belt shows red, blue, red, blue, red. What comes next?",
            "Blue",
            ["Red", "Green"],
            "The pattern goes red, blue, red, blue. After red comes blue.",
        )
        vs.c(
            "The belt shows big, small, big, small, big. What comes next?",
            "Small",
            ["Big", "Tiny"],
            "Big and small take turns. After big comes small.",
        )
        vs.c(
            "The belt shows star, heart, star, heart, star. What comes next?",
            "Heart",
            ["Star", "Moon"],
            "Star and heart take turns, so heart is next.",
            {"Heart": "heart", "Star": "star", "Moon": "moon"},
        )
        vs.c(
            "The belt shows drum, bear, drum, bear. What comes next?",
            "Drum",
            ["Bear", "Ball"],
            "The pattern goes drum, bear. We start again with drum.",
        )
        vs.c(
            "The belt shows yellow, green, yellow, green, yellow. What comes next?",
            "Green",
            ["Yellow", "Red"],
            "Yellow and green take turns, so green is next.",
        )
        hints = [
            "Say the pattern out loud: red, blue, red, blue.",
            "Which one came before the last one?",
        ]
    elif band == "PATHFINDER":
        vs.c(
            "The belt shows bear, drum, bear, drum, bear. What comes next?",
            "Drum",
            ["Bear", "Train"],
            "The pattern is AB: bear, drum. After bear comes drum.",
        )
        vs.c(
            "The belt shows star, ball, drum, star, ball. What comes next?",
            "Drum",
            ["Star", "Ball"],
            "The pattern is ABC: star, ball, drum, and it starts again. After ball comes drum.",
        )
        vs.c(
            "The belt shows red, red, blue, red, red, blue, red, red. What comes next?",
            "Blue",
            ["Red", "Green"],
            "The pattern is red, red, blue. After two reds comes blue.",
        )
        vs.c(
            "The belt shows circle, square, triangle, circle, square, triangle, circle. What comes "
            "next?",
            "Square",
            ["Triangle", "Circle"],
            "The pattern is circle, square, triangle. After circle comes square.",
        )
        vs.c(
            "The belt shows 1 bow, 2 bows, 3 bows, 4 bows. How many bows come next?",
            "5 bows",
            ["3 bows", "6 bows"],
            "Each present has one more bow than the one before. After 4 comes 5.",
        )
        hints = [
            "Find the part that repeats.",
            "Say the repeating part over and over, then find where you stopped.",
        ]
    else:
        vs.c(
            "The belt shows A A B, A A B, A A. What comes next?",
            "B",
            ["A", "C", "A A"],
            "The pattern is A A B. After two As comes a B.",
        )
        vs.c(
            "The belt shows circle, square, square, circle, square, square, circle. What comes "
            "next?",
            "Square",
            ["Circle", "Triangle", "Star"],
            "The pattern is circle, square, square. After circle comes square.",
        )
        vs.c(
            "Presents get one more bow each time: 1 bow, 2 bows, 3 bows, 4 bows. How many bows "
            "does the sixth present have?",
            "6 bows",
            ["5 bows", "7 bows", "8 bows"],
            "The fifth present has 5 bows, and the sixth has one more, which is 6.",
        )
        vs.c(
            "The belt shows red, blue, yellow, green, red, blue, yellow. What comes next?",
            "Green",
            ["Red", "Blue", "Yellow"],
            "Four colours repeat: red, blue, yellow, green. After yellow comes green.",
        )
        vs.c(
            "The belt shows bear, bear, drum, drum, bear, bear, drum. What comes next?",
            "Drum",
            ["Bear", "Train", "Doll"],
            "The pattern is two bears then two drums. We have only one drum so far, so another "
            "drum comes next.",
        )
        hints = [
            "Find the shortest part that repeats.",
            "Cover the start, then check that the repeating part matches each time.",
        ]
    return _quiz(vs, "CARDS", "LOGIC", "patterns", hints)


# --- 5 np-workshop-assemble ------------------------------------------------------------------


def _workshop_assemble(band):
    vs = _Vs("np-workshop-assemble", band)
    if band == "SPROUT":
        vs.o(
            "Build a toy train. Press the pieces in order: first the wheels, then the carriage, "
            "then the flag.",
            [("wheels", "Wheels"), ("carriage", "Carriage"), ("flag", "Flag")],
            "Wheels go first so the train can roll. Then the carriage sits on top, and the flag "
            "goes on last.",
        )
        vs.o(
            "Make a teddy bear. First the stuffing, then the stitches, then the bow.",
            [("stuffing", "Stuffing"), ("stitches", "Stitches"), ("bow", "Bow")],
            "The stuffing goes in first. Then we close it with stitches, and last we add the bow.",
        )
        vs.o(
            "Wrap a present. First the box, then the paper, then the ribbon.",
            [("box", "Box"), ("paper", "Paper"), ("ribbon", "Ribbon")],
            "We need the box before the paper can go around it. The ribbon finishes it.",
        )
        vs.o(
            "Paint a wooden drum. First the wood, then the paint, then the sparkles.",
            [("wood", "Wooden drum"), ("paint", "Paint"), ("sparkles", "Sparkles")],
            "The paint goes on the wood first. Sparkles stick on when the paint is on.",
        )
        hints = [
            "Listen for first, then, and last.",
            "What does the toy need before the next piece can go on?",
        ]
    elif band == "PATHFINDER":
        vs.o(
            "Make a wooden horse. Which order works? Cut the wood, sand it smooth, paint it, then "
            "let it dry.",
            [
                ("cut", "Cut the wood"),
                ("sand", "Sand it smooth"),
                ("paint", "Paint it"),
                ("dry", "Let it dry"),
            ],
            "We cut the shape first, smooth it, then paint. Paint needs time to dry before anyone "
            "plays.",
        )
        vs.o(
            "Build a toy snowman. Roll the big ball, add the middle ball, add the head, then add "
            "the hat.",
            [("big", "Big ball"), ("middle", "Middle ball"), ("head", "Head"), ("hat", "Hat")],
            "The big ball is the base, so it goes first. Each smaller part sits on the one below. "
            "The hat goes on top.",
        )
        vs.o(
            "Wrap a gift. Put the toy in the box, close the box, wrap the paper, tie the ribbon.",
            [
                ("toy", "Toy in the box"),
                ("close", "Close the box"),
                ("wrap", "Wrap the paper"),
                ("ribbon", "Tie the ribbon"),
            ],
            "The toy goes in before the box is closed. Paper goes around the closed box, and the "
            "ribbon holds it.",
        )
        vs.o(
            "Make a kite. Cut the paper, tape on the sticks, tie on the string, then add the tail.",
            [
                ("paper", "Cut the paper"),
                ("sticks", "Tape on the sticks"),
                ("string", "Tie on the string"),
                ("tail", "Add the tail"),
            ],
            "The kite needs its frame before the string and tail can be added.",
        )
        hints = [
            "Think about what has to be done before the next part.",
            "Which part is the last thing you do?",
        ]
    else:
        vs.o(
            "Build a toy robot. First put the legs on the body. Then add the arms. Next, attach "
            "the head. After that, paint the eyes. Last, wrap it in paper.",
            [
                ("legs", "Put on the legs"),
                ("arms", "Add the arms"),
                ("head", "Attach the head"),
                ("eyes", "Paint the eyes"),
                ("wrap", "Wrap it in paper"),
            ],
            "The words first, then, next, after that and last give the order. The body comes "
            "before the head, and the paint is on before wrapping.",
        )
        vs.o(
            "Make a toy sleigh. Cut two long runners. Next, nail the seat on top of them. Then add "
            "the sleigh bell at the front. Finally, polish it.",
            [
                ("runners", "Cut two runners"),
                ("seat", "Nail on the seat"),
                ("bell", "Add the bell"),
                ("polish", "Polish it"),
            ],
            "The runners come first because the seat sits on them. The bell is added at the front, "
            "and polishing is the final step.",
        )
        vs.o(
            "Bake a toy snow globe. Fill the jar with water. Then drop in the glitter. Next, screw "
            "on the lid. Last, turn it over and shake it.",
            [
                ("water", "Fill the jar"),
                ("glitter", "Drop in the glitter"),
                ("lid", "Screw on the lid"),
                ("shake", "Turn it and shake it"),
            ],
            "The jar is filled first, then the glitter goes in. The lid goes on before we shake it "
            "so nothing spills.",
        )
        vs.o(
            "Make a rocking horse. Saw the wood. Sand every edge. Paint the horse. Put on the "
            "rockers. Last, add a ribbon mane.",
            [
                ("saw", "Saw the wood"),
                ("sand", "Sand every edge"),
                ("paint", "Paint the horse"),
                ("rockers", "Put on the rockers"),
                ("mane", "Add the mane"),
            ],
            "Wood is cut first and sanded before painting. The rockers and the mane are finishing "
            "touches.",
        )
        hints = [
            "Look for the words first, then, next and last.",
            "Start with the step that has first. Then look for what comes right after it.",
        ]
    return _quiz(vs, "SWITCHES", "LOGIC", "sequencing", hints)


# --- 6 np-forest-sequence --------------------------------------------------------------------


def _forest_sequence(band):
    vs = _Vs("np-forest-sequence", band)
    if band == "SPROUT":
        vs.a(
            "add",
            (3, 1),
            "The candy cane trees show 1, 2, 3. Which number comes next?",
            "We count up by one each time. After 3 comes {r}.",
            lo=1,
            hi=5,
            deltas=(1, -1, -2, 2),
        )
        vs.a(
            "add",
            (2, 1),
            "The stepping stones say 1, 2. Which number is on the next stone?",
            "We count up by one. After 2 comes {r}.",
            lo=1,
            hi=5,
            deltas=(1, -1, 2, -2),
        )
        vs.a(
            "add",
            (4, 1),
            "The path signs say 2, 3, 4. Which number comes next?",
            "Each sign is one more. After 4 comes {r}.",
            lo=1,
            hi=5,
            deltas=(-1, -2, 1, 2),
        )
        vs.a(
            "add",
            (1, 1),
            "The first sign says 1. What number comes next when we count?",
            "Counting goes 1, then {r}.",
            lo=1,
            hi=5,
            deltas=(1, 2, -1),
        )
        vs.a(
            "add",
            (3, 1),
            "The peppermint stones say 2, 3. Which number comes next?",
            "We add one each time, so after 3 comes {r}.",
            lo=1,
            hi=5,
            deltas=(-1, 1, 2, -2),
        )
        hints = ["Count from one: 1, 2, 3.", "Which number comes right after the last one?"]
    elif band == "PATHFINDER":
        vs.a(
            "add",
            (6, 2),
            "The stones say 2, 4, 6, and the next stone is hidden. We count by 2s. Which number is "
            "on it?",
            "Counting by 2s adds 2 each time. After 6 comes 6 + 2 = {r}.",
            deltas=(-2, 2, 1, -1),
        )
        vs.a(
            "add",
            (7, 1),
            "The signs say 5, 6, 7. We count by 1s. What number comes next?",
            "Counting by 1s adds 1. After 7 comes {r}.",
            deltas=(1, -1, 2),
        )
        vs.a(
            "add",
            (8, 2),
            "The trees say 4, 6, 8. We count by 2s. What number comes next?",
            "Adding 2 each time: 4, 6, 8, {r}.",
            deltas=(-2, 2, 1, -1),
        )
        vs.a(
            "sub",
            (6, 2),
            "The signs count backwards: 10, 8, 6. We count back by 2s. What comes next?",
            "Counting back by 2s takes 2 away each time. 6 - 2 = {r}.",
            deltas=(2, -2, 1, -1),
        )
        vs.a(
            "add",
            (3, 2),
            "The candy canes say 1, 3, 5. We count by 2s starting at 1. "
            "Which number comes after 5?",
            "Adding 2 each time: 1, 3, 5, 7. So the next number is {r}. These are odd numbers.",
            extra=(6,),
            deltas=(-1, 1, -2),
        )
        hints = [
            "Find how much the numbers go up or down each time.",
            "Add or take away that same amount from the last number.",
        ]
    else:
        vs.a(
            "add",
            (15, 5),
            "The stones say 5, 10, 15. We count by 5s. What number is on the next stone?",
            "Counting by 5s adds 5 each time. 15 + 5 = {r}.",
            deltas=(-5, 5, 1, -1, 10),
        )
        vs.a(
            "add",
            (50, 10),
            "The signs say 30, 40, 50. We count by 10s. What number comes next?",
            "Counting by 10s adds 10 each time. 50 + 10 = {r}.",
            deltas=(-10, 10, 1, -1, 5),
        )
        vs.a(
            "add",
            (12, 3),
            "The trees say 3, 6, 9, 12. We count by 3s. What number comes next?",
            "Counting by 3s adds 3 each time. 12 + 3 = {r}.",
            deltas=(-3, 3, 1, -1, 2),
        )
        vs.a(
            "sub",
            (80, 10),
            "The signs count backwards by 10s: 100, 90, 80. What number comes next?",
            "Counting back by 10s takes away 10 each time. 80 - 10 = {r}.",
            deltas=(10, -10, 1, -1, 20),
        )
        vs.a(
            "add",
            (8, 4),
            "The candy canes show 4, 8, 12, 16. We count by 4s. What comes after 16?",
            "Counting by 4s adds 4 each time. 16 + 4 = {r}.",
            extra=(18, 24),
            deltas=(-4, 1, -1),
        )
        hints = [
            "Check the gap between the first two numbers, "
            "then check it again between the next two.",
            "Add the gap to the last number, or take it away if the numbers count down.",
        ]
    return _quiz(
        vs, "PATHS", "MATHEMATICS", "patterns" if band != "SPROUT" else "counting-sets", hints
    )


# --- 7 np-forest-signs -----------------------------------------------------------------------


def _forest_signs(band):
    vs = _Vs("np-forest-signs", band)
    if band == "SPROUT":
        vs.c(
            "Peppermint starts with the sound p. Which word starts with p too?",
            "Pig",
            ["Sun", "Hat"],
            "Pig starts with the sound p, just like peppermint.",
        )
        vs.c(
            "Snow starts with the sound s. Which word starts with s?",
            "Sock",
            ["Bed", "Cup"],
            "Sock and snow both start with the sound s.",
        )
        vs.c(
            "Candy starts with the sound k, like cat. Which word starts with the same sound?",
            "Cat",
            ["Dog", "Fish"],
            "Cat and candy both start with the sound k.",
        )
        vs.c(
            "Which word rhymes with snow?",
            "Go",
            ["Cat", "Sun"],
            "Snow and go end with the same sound, so they rhyme.",
        )
        vs.c(
            "The sign has a picture of a snowman. What does the sign show?",
            "A snowman",
            ["A boat", "A sun"],
            "A picture on a sign tells us what is there. This one shows a snowman.",
        )
        hints = [
            "Say the word slowly and listen to the first sound.",
            "Say each choice out loud and listen for a match.",
        ]
    elif band == "PATHFINDER":
        vs.c(
            "A sign says GO LEFT. Which way do you walk?",
            "To the left",
            ["To the right", "Backwards"],
            "The sign says LEFT, so we walk to the left.",
        )
        vs.c(
            "A sign says STOP. What do you do?",
            "Stand still and wait",
            ["Run faster", "Jump up and down"],
            "STOP means we stand still and wait until it is safe to go on.",
        )
        vs.c(
            "A sign says CANDY IS UP THE HILL. Where is the candy?",
            "Up the hill",
            ["Down the hill", "In the lake"],
            "The words UP THE HILL tell us the candy is higher up, on the hill.",
        )
        vs.c(
            "A sign says NO RUNNING. What does it ask you to do?",
            "Walk slowly",
            ["Run fast", "Jump high"],
            "NO RUNNING asks us to walk, so nobody slips on the ice.",
        )
        vs.c(
            "The arrow points right and the sign says PEPPERMINT PATH. Which way is the Peppermint "
            "Path?",
            "To the right",
            ["To the left", "Straight up"],
            "The arrow points right, so the Peppermint Path is that way.",
        )
        hints = [
            "Read the words slowly, one at a time.",
            "Look for words you know, like GO, STOP and UP.",
        ]
    else:
        vs.c(
            "A sign says: SLIPPERY ICE AHEAD. Walk slowly and hold the rope. The sweet shop is "
            "past the bridge. What should you do on the ice?",
            "Walk slowly and hold the rope",
            ["Run to the bridge", "Skip across the ice", "Slide on your tummy"],
            "The sign tells us to walk slowly and hold the rope, because ice is slippery.",
        )
        vs.c(
            "A sign says: The Peppermint Path has 3 turns. Turn left at the red pole. Then turn "
            "right at the tall tree. Last, turn left again. Where do you turn first?",
            "Left at the red pole",
            ["Right at the tall tree", "Left at the last turn", "Straight past the pole"],
            "The first turn is the one that comes first in the sign: left at the red pole.",
        )
        vs.c(
            "A sign says: Candy canes taste best when they are ripe. Please do not pick them "
            "early. What does the sign ask you not to do?",
            "Pick the candy canes early",
            ["Taste the candy canes", "Walk on the path", "Look at the trees"],
            "The sign says please do not pick them early, so they can ripen.",
        )
        vs.c(
            "A sign says: Deer crossing. Slow down near the trees. Reindeer rest under the pines. "
            "Where do the reindeer rest?",
            "Under the pines",
            ["Near the lake", "On the bridge", "In the workshop"],
            "The last sentence says reindeer rest under the pines.",
        )
        vs.c(
            "A sign says: The workshop door opens when the bell rings twice. Wait by the gate. How "
            "many times must the bell ring?",
            "Two times",
            ["One time", "Three times", "Four times"],
            "The word twice means two times, so the door opens after two rings.",
        )
        hints = [
            "Read the whole sign, then read the question.",
            "Look for the sentence in the sign that answers the question.",
        ]
    skill = {
        "SPROUT": "phonemic-awareness",
        "PATHFINDER": "sight-words",
        "EXPLORER": "reading-comprehension",
    }[band]
    return _quiz(vs, "PATHS", "LITERACY", skill, hints)


# --- 8 np-forest-stripes ---------------------------------------------------------------------


def _forest_stripes(band):
    vs = _Vs("np-forest-stripes", band)
    if band == "SPROUT":
        vs.o(
            "Put the candy stripes in order: red, then white, then green.",
            [("red", "Red stripe"), ("white", "White stripe"), ("green", "Green stripe")],
            "We follow the colour order we heard: red first, then white, then green.",
        )
        vs.o(
            "Put the stripes in order from the smallest to the biggest.",
            [("small", "Small stripe"), ("middle", "Middle stripe"), ("big", "Big stripe")],
            "Smallest comes first, then the middle one, and the biggest comes last.",
        )
        vs.o(
            "Put the stripes in order: 1 dot, then 2 dots, then 3 dots.",
            [("one", "1 dot"), ("two", "2 dots"), ("three", "3 dots")],
            "Each stripe has one more dot than the one before.",
        )
        vs.o(
            "Put the stripes in order: yellow, then blue, then pink.",
            [("yellow", "Yellow stripe"), ("blue", "Blue stripe"), ("pink", "Pink stripe")],
            "We set them in the order we heard: yellow, blue, pink.",
        )
        hints = [
            "Listen for the first colour, then the next.",
            "Which one goes at the bottom of the candy cane?",
        ]
    elif band == "PATHFINDER":
        vs.o(
            "Put the stripes in order from the smallest to the biggest.",
            [
                ("xs", "Tiny stripe"),
                ("s", "Small stripe"),
                ("m", "Medium stripe"),
                ("l", "Large stripe"),
            ],
            "Each stripe is a bit bigger than the one before, so we start with the tiniest.",
        )
        vs.o(
            "Follow the rainbow order: red, orange, yellow, green.",
            [("red", "Red"), ("orange", "Orange"), ("yellow", "Yellow"), ("green", "Green")],
            "A rainbow always goes red, orange, yellow, green, then blue and violet.",
        )
        vs.o(
            "Each stripe has 2 more dots than the one before. Put them in order, starting with 2 "
            "dots.",
            [("d2", "2 dots"), ("d4", "4 dots"), ("d6", "6 dots"), ("d8", "8 dots")],
            "Counting by 2s gives 2, 4, 6, 8. Each stripe adds 2 dots.",
        )
        vs.o(
            "Put the stripes in order from the biggest to the smallest.",
            [
                ("l", "Large stripe"),
                ("m", "Medium stripe"),
                ("s", "Small stripe"),
                ("xs", "Tiny stripe"),
            ],
            "This time we start with the largest and end with the tiniest.",
        )
        vs.o(
            "Put the numbers on the stripes in order from 1 to 4.",
            [("n1", "Stripe 1"), ("n2", "Stripe 2"), ("n3", "Stripe 3"), ("n4", "Stripe 4")],
            "Counting up goes 1, 2, 3, 4.",
        )
        hints = [
            "Find the rule first: size, colour, or counting.",
            "Start with the first thing in the rule.",
        ]
    else:
        vs.o(
            "Put the candy sticks in order from the shortest to the longest.",
            [("c7", "7 cm"), ("c9", "9 cm"), ("c12", "12 cm"), ("c15", "15 cm"), ("c20", "20 cm")],
            "Comparing the numbers tells us the lengths: 7 is the least and 20 is the most.",
        )
        vs.o(
            "Put the candy sticks in order from the longest to the shortest.",
            [("c18", "18 cm"), ("c14", "14 cm"), ("c11", "11 cm"), ("c8", "8 cm"), ("c5", "5 cm")],
            "The biggest number is the longest stick, so it goes first.",
        )
        vs.o(
            "Put the stripe numbers in order, counting by 10s from the smallest.",
            [("t10", "10"), ("t20", "20"), ("t30", "30"), ("t40", "40"), ("t50", "50")],
            "Counting by 10s goes 10, 20, 30, 40, 50.",
        )
        vs.o(
            "Put the candy cane pieces in order from the smallest part to the whole: a quarter, a "
            "half, three quarters, a whole.",
            [("q", "A quarter"), ("h", "A half"), ("tq", "Three quarters"), ("w", "A whole")],
            "A quarter is 1 of 4 equal parts, a half is 2 of 4, three quarters is 3 of 4, and the "
            "whole is all 4.",
        )
        vs.o(
            "The pattern doubles each time. Put the stripes in order: 3 dots, 6 dots, 12 dots, 24 "
            "dots.",
            [("d3", "3 dots"), ("d6", "6 dots"), ("d12", "12 dots"), ("d24", "24 dots")],
            "Each stripe has double the dots of the one before: 3, 6, 12, 24.",
        )
        hints = [
            "Find the smallest number or the smallest piece first.",
            "Check each pair next to each other to see if they are in order.",
        ]
    return _quiz(vs, "PATH", "LOGIC", "sequencing", hints)


# --- 9 np-lake-sums (floes a, b, c in every variant) -----------------------------------------


def _lake_sums(band):
    vs = _Vs("np-lake-sums", band, wrongs=2)
    if band == "SPROUT":
        vs.a(
            "id",
            (3,),
            "Hop on the floe with 3 snowflakes. Which floe says 3?",
            "The number 3 means three things. The floe that says 3 is safe to hop on.",
            lo=1,
            hi=5,
            deltas=(1, 2, -1, -2),
        )
        vs.a(
            "add",
            (1, 1),
            "One penguin joins one more penguin. How many penguins are on the ice?",
            "1 penguin and 1 more penguin make {r}.",
            lo=1,
            hi=5,
            deltas=(1, -1, 2),
        )
        vs.a(
            "id",
            (5,),
            "Hop on the floe with 5 snowballs. Which floe says 5?",
            "The number 5 means five. Count the snowballs one by one to check.",
            lo=1,
            hi=5,
            deltas=(-1, -2, -3),
        )
        vs.a(
            "add",
            (2, 1),
            "Two fish are in the water and one more swims up. How many fish are there?",
            "2 and 1 more make {r}.",
            lo=1,
            hi=5,
            deltas=(1, -1, 2),
        )
        vs.a(
            "id",
            (2,),
            "Which floe says the number 2?",
            "The number 2 is one more than 1 and one less than 3.",
            lo=1,
            hi=5,
            deltas=(1, 2, -1),
        )
        hints = [
            "Count the things, then find the same number.",
            "Say the numbers out loud as you point.",
        ]
    elif band == "PATHFINDER":
        vs.a(
            "add",
            (4, 3),
            "Which floe has the answer? 4 + 3 = ?",
            "4 and 3 make {r}.",
            deltas=(1, -1, 2, -2),
        )
        vs.a(
            "sub",
            (9, 4),
            "Which floe has the answer? 9 - 4 = ?",
            "If we take 4 away from 9, there are {r} left.",
            deltas=(1, -1, 2, -2),
        )
        vs.a(
            "add",
            (6, 3),
            "Which floe has the answer? 6 + 3 = ?",
            "6 and 3 more make {r}.",
            deltas=(1, -1, 2, -2),
        )
        vs.a(
            "sub",
            (8, 5),
            "Which floe has the answer? 8 - 5 = ?",
            "Taking 5 away from 8 leaves {r}.",
            deltas=(1, -1, 2, -2),
        )
        vs.a(
            "add",
            (5, 5),
            "Which floe has the answer? 5 + 5 = ?",
            "5 and 5 make 10. Two hands of five fingers make ten.",
            deltas=(1, -1, -2, 2),
        )
        vs.a(
            "sub",
            (10, 3),
            "Which floe has the answer? 10 - 3 = ?",
            "Ten with 3 taken away is {r}.",
            deltas=(1, -1, 2, -2),
        )
        hints = [
            "Draw the number as dots, then add or take away.",
            "Count on for adding, or count back for taking away.",
        ]
    else:
        vs.a(
            "add",
            (23, 14),
            "Which floe has the answer? 23 + 14 = ?",
            "Add the tens (20 + 10 = 30), then the ones (3 + 4 = 7). The total is {r}.",
            extra=(27,),
            deltas=(10, -10, 1, -1),
        )
        vs.a(
            "add",
            (38, 15),
            "Which floe has the answer? 38 + 15 = ?",
            "8 + 5 = 13 ones, which is 1 ten and 3 ones. Then 30 + 10 + 10 = 50, so the total is "
            "{r}.",
            extra=(43, 63),
            deltas=(1, -1, 10),
        )
        vs.a(
            "sub",
            (58, 21),
            "Which floe has the answer? 58 - 21 = ?",
            "Take away 2 tens to get 38, then take away 1 more to get {r}.",
            extra=(39, 37 + 10),
            deltas=(1, -1, 10),
        )
        vs.a(
            "add",
            (46, 27),
            "Which floe has the answer? 46 + 27 = ?",
            "40 + 20 = 60 and 6 + 7 = 13. Then 60 + 13 = {r}.",
            extra=(63, 72),
            deltas=(1, -1, 10),
        )
        vs.a(
            "sub",
            (64, 28),
            "Which floe has the answer? 64 - 28 = ?",
            "Take away 20 to get 44, then take away 8 more: 44 - 8 = {r}.",
            extra=(44, 46),
            deltas=(1, -1, 10),
        )
        vs.a(
            "sub",
            (90, 45),
            "Which floe has the answer? 90 - 45 = ?",
            "Take away 40 to get 50, then take away 5 more. That leaves {r}.",
            extra=(55, 135),
            deltas=(1, -1, 10),
        )
        hints = [
            "Split the numbers into tens and ones.",
            "Do the tens first, then the ones, then put them back together.",
        ]
    skill = {
        "SPROUT": "counting-sets",
        "PATHFINDER": "addition-within-ten",
        "EXPLORER": "addition-two-digit",
    }[band]
    return _quiz(
        vs,
        "PLATFORMS",
        "MATHEMATICS",
        skill,
        hints,
        optionEntities=ENTITY_MAPS["np-lake-sums"][band]["optionEntities"],
    )


# --- 10 np-lake-order (floes a, b, c, (d)) ---------------------------------------------------


def _lake_order(band):
    vs = _Vs("np-lake-order", band)
    if band == "SPROUT":
        vs.lake(
            [3, 1, 2],
            "The floes show numbers. Hop on 1 first, then 2, then 3.",
            "We hop in counting order: 1, then 2, then 3.",
        )
        vs.lake(
            [2, 3, 1],
            "Hop from the smallest number to the biggest.",
            "The smallest number is 1, then 2, then 3.",
        )
        vs.lake(
            [5, 4, 3],
            "Hop on the floes from the smallest number to the biggest.",
            "Counting up goes 3, 4, 5.",
        )
        vs.lake(
            [2, 5, 4],
            "Hop from the smallest number to the biggest.",
            "2 is the smallest, then 4, then 5.",
        )
        hints = [
            "Start with the floe that shows the smallest number.",
            "Count up: which number comes next?",
        ]
    elif band == "PATHFINDER":
        vs.lake(
            [7, 3, 9, 5],
            "Hop from the smallest number to the biggest.",
            "The numbers in order are 3, 5, 7, 9.",
        )
        vs.lake(
            [12, 8, 15, 10],
            "Hop from the smallest number to the biggest.",
            "In order they are 8, 10, 12, 15.",
        )
        vs.lake(
            [6, 2, 8, 4],
            "Hop from the smallest number to the biggest.",
            "Counting by 2s, the order is 2, 4, 6, 8.",
        )
        vs.lake(
            [14, 11, 19, 16],
            "Hop from the biggest number to the smallest.",
            "From the biggest to the smallest: 19, 16, 14, 11.",
            descending=True,
        )
        vs.lake(
            [10, 20, 15, 5],
            "Hop from the smallest number to the biggest.",
            "In order they are 5, 10, 15, 20.",
        )
        hints = [
            "Find the smallest number first.",
            "After you pick one, look for the next biggest.",
        ]
    else:
        vs.lake(
            [48, 84, 39, 93],
            "Hop from the smallest number to the biggest.",
            "Compare the tens first: 39, 48, 84, 93.",
        )
        vs.lake(
            [67, 76, 58, 85],
            "Hop from the smallest number to the biggest.",
            "Look at the tens digit first: 58, 67, 76, 85.",
        )
        vs.lake(
            [120, 99, 105, 87],
            "Hop from the biggest number to the smallest.",
            "A number with three digits is bigger than one with two. From biggest: 120, 105, 99, "
            "87.",
            descending=True,
        )
        vs.lake(
            [35, 53, 33, 55],
            "Hop from the smallest number to the biggest.",
            "Compare tens, then ones: 33, 35, 53, 55.",
        )
        vs.lake(
            [250, 205, 520, 502],
            "Hop from the smallest number to the biggest.",
            "Compare hundreds, then tens: 205, 250, 502, 520.",
        )
        hints = [
            "Compare the tens digit of each number first.",
            "If the tens match, compare the ones.",
        ]
    maps = ENTITY_MAPS["np-lake-order"][band]
    return _quiz(vs, "PATH", "MATHEMATICS", "number-order", hints, **maps)


# --- 11 np-lake-shapes -----------------------------------------------------------------------


def _lake_shapes(band):
    vs = _Vs("np-lake-shapes", band)
    shape_syms = {"Circle": "circle", "Square": "square", "Triangle": "triangle"}
    if band == "SPROUT":
        vs.c(
            "Which shape is round like the moon?",
            "Circle",
            ["Square", "Triangle"],
            "A circle is round all the way around, like the moon.",
            shape_syms,
        )
        vs.c(
            "Which shape has 3 sides?",
            "Triangle",
            ["Circle", "Square"],
            "A triangle has 3 sides and 3 corners.",
            shape_syms,
        )
        vs.c(
            "Which shape has 4 sides that are the same?",
            "Square",
            ["Circle", "Triangle"],
            "A square has 4 sides, and they are all the same length.",
            shape_syms,
        )
        vs.c(
            "Which shape has no corners?",
            "Circle",
            ["Square", "Triangle"],
            "A circle is smooth and curved. It has no corners.",
            shape_syms,
        )
        vs.c(
            "Which floe is shaped like a triangle?",
            "Triangle",
            ["Square", "Circle"],
            "A triangle has 3 straight sides that meet at 3 corners.",
            shape_syms,
        )
        hints = ["Look at the shape on each card.", "Count the straight sides with your finger."]
    elif band == "PATHFINDER":
        vs.c(
            "How many sides does a square have?", "4", ["3", "5"], "A square has 4 straight sides."
        )
        vs.c(
            "How many corners does a triangle have?",
            "3",
            ["2", "4"],
            "A triangle has 3 corners. That is why it is called tri, which means three.",
        )
        vs.c(
            "A cookie is cut into 2 equal parts. What do we call each part?",
            "A half",
            ["A quarter", "A whole"],
            "When something is shared into 2 equal parts, each part is a half.",
        )
        vs.c(
            "Which shape has 6 sides?",
            "Hexagon",
            ["Square", "Triangle"],
            "A hexagon has 6 sides. A snowflake can look like a hexagon.",
            {"Hexagon": "hexagon", "Square": "square", "Triangle": "triangle"},
        )
        vs.c(
            "A pizza is cut into 4 equal parts. What do we call one part?",
            "A quarter",
            ["A half", "A whole"],
            "4 equal parts mean each part is a quarter.",
        )
        hints = ["Draw the shape in your head and count.", "Equal parts must be the same size."]
    else:
        for n in (12, 8, 20, 6):
            vs.a(
                "div",
                (n, 2),
                "Half of {0} is the same as sharing {0} into 2 equal groups. What is half of {0}?",
                "Half of {0} means {0} shared into 2 equal groups. Each group has {r}.",
                extra=(n // 2 + 1,),
                deltas=(-1, 1, 2),
            )
        vs.a(
            "div",
            (8, 4),
            "A quarter of 8 means 8 shared into 4 equal groups. What is a quarter of 8?",
            "8 shared into 4 equal groups gives {r} in each group.",
            extra=(4, 3),
            deltas=(1, -1),
        )
        vs.a(
            "div",
            (20, 4),
            "A quarter of 20 snowflakes means 20 shared into 4 equal groups. How many snowflakes "
            "is that?",
            "20 divided by 4 is {r}. That is one quarter.",
            extra=(10, 4),
            deltas=(1, -1),
        )
        vs.c(
            "Which fraction is bigger: a half or a quarter of the same pie?",
            "A half",
            ["A quarter", "They are the same", "It depends on the colour"],
            "Cutting into 2 pieces makes bigger pieces than cutting into 4. So a half is bigger "
            "than a quarter.",
        )
        hints = [
            "Share the number into equal groups.",
            "A half is 2 equal groups. A quarter is 4 equal groups.",
        ]
    skill = {"SPROUT": "shapes", "PATHFINDER": "shapes-and-halves", "EXPLORER": "fractions"}[band]
    return _quiz(vs, "SHAPES", "MATHEMATICS", skill, hints)


# --- 12 np-stables-facts ---------------------------------------------------------------------


def _stables_facts(band):
    vs = _Vs("np-stables-facts", band)
    if band == "SPROUT":
        vs.c(
            "What do reindeer have on their heads?",
            "Antlers",
            ["Wings", "Horns of a goat"],
            "Reindeer grow antlers. They look like tall branches.",
        )
        vs.c(
            "How many legs does a reindeer have?",
            "4",
            ["2", "6"],
            "A reindeer is an animal with 4 legs, so it can walk and run well.",
        )
        vs.c(
            "Which feet does a reindeer have?",
            "Hooves",
            ["Flippers", "Wings"],
            "Reindeer walk on hooves, which are hard, strong feet.",
        )
        vs.c(
            "Are reindeer warm in the snow?",
            "Yes, they have thick fur",
            ["No, they are bald", "Only with a scarf"],
            "Reindeer have thick fur that keeps them warm in cold places.",
        )
        vs.c(
            "What is a baby reindeer called?",
            "A calf",
            ["A puppy", "A chick"],
            "A baby reindeer is called a calf.",
        )
        hints = ["Think about what a reindeer looks like.", "Look at the reindeer in the stables."]
    elif band == "PATHFINDER":
        vs.c(
            "Why do reindeer have thick fur?",
            "To stay warm in the cold",
            ["To swim fast", "To be loud"],
            "Thick fur traps warm air near the body, which helps reindeer stay warm in snow and "
            "wind.",
        )
        vs.c(
            "Which reindeer grow antlers?",
            "Both boys and girls",
            ["Only boys", "Only babies"],
            "Both male and female reindeer grow antlers. Reindeer are special in this way.",
        )
        vs.c(
            "What do we call a group of reindeer?",
            "A herd",
            ["A flock", "A pack"],
            "A group of reindeer is called a herd.",
        )
        vs.c(
            "Where do reindeer live?",
            "In cold places",
            ["In hot deserts", "Under the sea"],
            "Reindeer live in cold northern lands where there is snow.",
        )
        vs.c(
            "What do reindeer have on their feet?",
            "Hooves",
            ["Paws", "Webbed feet"],
            "Reindeer have hooves, strong feet for walking on snow and ice.",
        )
        hints = ["Think about where reindeer live.", "What helps an animal that lives in the cold?"]
    else:
        vs.c(
            "Why are reindeer hooves wide?",
            "They spread out so reindeer do not sink in snow",
            ["They help reindeer swim", "They make them noisy", "They help them climb trees"],
            "Wide hooves spread the weight, like snowshoes, so reindeer walk on top of the snow.",
        )
        vs.c(
            "Which reindeer grow antlers?",
            "Both males and females",
            ["Only males", "Only females", "Neither"],
            "Reindeer are the only deer where both males and females grow antlers.",
        )
        vs.c(
            "What do reindeer do with their antlers each year?",
            "They shed them and grow new ones",
            ["Keep the same ones forever", "Cut them off with their hooves", "Paint them"],
            "Antlers fall off and a new pair grows every year. They are not horns, which stay for "
            "life.",
        )
        vs.c(
            "Why does thick fur keep a reindeer warm?",
            "It traps air near its body",
            [
                "It makes the reindeer run faster",
                "It makes snow melt",
                "It makes the reindeer heavier",
            ],
            "Air trapped in the fur holds the warmth, like air in a coat.",
        )
        vs.c(
            "What is a group of reindeer called?",
            "A herd",
            ["A swarm", "A school", "A pride"],
            "A herd is a group of reindeer that travel and eat together.",
        )
        hints = [
            "Think about how an animal's body helps it live in snow.",
            "Which choice explains why the feature is useful?",
        ]
    return _quiz(vs, "CARDS", "LIFE_SCIENCE", "animal-science", hints)


# --- 13 np-stables-tracks --------------------------------------------------------------------


def _stables_tracks(band):
    vs = _Vs("np-stables-tracks", band)
    if band == "SPROUT":
        vs.c(
            "Snowball is a little reindeer. Which prints are Snowball's?",
            "Small prints",
            ["Big prints"],
            "A little reindeer makes small prints. A big reindeer makes big prints.",
        )
        vs.c(
            "The prints go toward the trees. Where did Snowball go?",
            "To the trees",
            ["To the lake", "Into the stable"],
            "Footprints show the way an animal walked. These go to the trees.",
        )
        vs.c(
            "Which prints are close together?",
            "Small steps",
            ["Long jumps"],
            "Prints close together mean small steps. Far apart means long steps or running.",
        )
        vs.c(
            "Which tracks are made by a big reindeer?",
            "Big prints",
            ["Tiny prints", "No prints"],
            "A big reindeer has a bigger hoof, so it leaves bigger prints.",
        )
        hints = ["Look at how big the prints are.", "Follow the prints with your finger."]
    elif band == "PATHFINDER":
        vs.c(
            "The prints start at the stable and end at the pine trees. Where did Snowball go?",
            "To the pine trees",
            ["Back to the stable", "Onto the frozen lake"],
            "The prints start at the stable and end at the pines, so Snowball walked to the pines.",
        )
        vs.c(
            "The prints are far apart. What was Snowball doing?",
            "Running",
            ["Sleeping", "Standing still"],
            "Long steps far apart mean a reindeer was running.",
        )
        vs.c(
            "The prints are close together. What was Snowball doing?",
            "Walking slowly",
            ["Running fast", "Flying"],
            "Prints close together mean small, slow steps.",
        )
        vs.c(
            "There are 3 sets of big prints and 1 set of small prints. Who is the little one?",
            "The one with the small prints",
            ["The one with the big prints", "We cannot tell"],
            "A little reindeer has a smaller hoof, so it makes smaller prints.",
        )
        vs.c(
            "The prints get fainter as they go. Where is the animal now?",
            "Far away from where we are",
            ["Right next to us", "In the stable"],
            "Fainter prints are older. The animal has moved on and is farther away.",
        )
        hints = [
            "Check where the prints start and end.",
            "Look at how close together the prints are.",
        ]
    else:
        vs.a(
            "mul",
            (5, 20),
            "Snowball takes {0} steps. Each step is {1} cm long. How far did Snowball walk in cm?",
            "{0} steps of {1} cm make {0} x {1} = {r} cm. That is 1 metre, because 100 cm is 1 m.",
            extra=(25,),
            deltas=(10, -10, 20),
        )
        vs.a(
            "add",
            (30, 30),
            "The prints are 30 cm apart. From one print to the print after the next, how many cm "
            "is that?",
            "Two steps of 30 cm make 30 + 30 = {r} cm.",
            extra=(30,),
            deltas=(10, -10, 30),
        )
        vs.c(
            "The prints get farther apart. What is Snowball probably doing?",
            "Speeding up",
            ["Slowing down", "Standing still", "Sleeping"],
            "Longer steps mean the reindeer is moving faster.",
        )
        vs.c(
            "Two sets of prints, one big and one small, walk side by side. What can you tell?",
            "A big and a small reindeer walked together",
            ["Two big reindeer walked together", "Only one reindeer walked", "Nobody walked there"],
            "Different print sizes mean different reindeer, and side by side means they stayed "
            "together.",
        )
        vs.a(
            "sub",
            (100, 60),
            "The pine tree is {0} cm from the stable. Snowball has walked {1} cm toward it. How "
            "many cm are left to walk?",
            "{0} cm minus {1} cm leaves {r} cm.",
            extra=(60,),
            deltas=(10, -10, 20),
        )
        hints = [
            "Use what you know about steps and measuring.",
            "For a total, multiply the steps by the step length.",
        ]
    skill = {"SPROUT": "observation", "PATHFINDER": "observation", "EXPLORER": "measurement"}[band]
    return _quiz(vs, "PATHS", "LOGIC", skill, hints)


# --- 14 np-stables-supplies ------------------------------------------------------------------


def _stables_supplies(band):
    vs = _Vs("np-stables-supplies", band)
    if band == "SPROUT":
        vs.c(
            "What can reindeer eat?",
            "Grass",
            ["Toy cars", "Shoes"],
            "Reindeer eat plants like grass. Toys and shoes are not food.",
        )
        vs.c(
            "Which one is food for a reindeer?",
            "Moss",
            ["A pencil", "A sock"],
            "Reindeer eat moss and other plants.",
        )
        vs.c(
            "Which do reindeer drink?",
            "Water",
            ["Paint", "Glue"],
            "Every animal needs fresh water to drink.",
        )
        vs.c(
            "What should we bring to the reindeer?",
            "Hay",
            ["A hat", "A drum"],
            "Hay is dried grass, and reindeer can eat it.",
        )
        hints = ["Think about what grows from the ground.", "Choose something an animal can eat."]
    elif band == "PATHFINDER":
        vs.c(
            "In winter reindeer dig in the snow for food. What are they looking for?",
            "Lichen and moss",
            ["Fish", "Ice cream"],
            "Reindeer dig through snow to find lichen and moss, which grow on the ground.",
        )
        vs.c(
            "Which supplies should we bring for the reindeer?",
            "Hay and fresh water",
            ["Candy and soda", "Toys and games"],
            "Reindeer need plant food and water to stay healthy.",
        )
        vs.c(
            "Reindeer eat plants only. What kind of eater is a reindeer?",
            "A plant eater",
            ["A meat eater", "A fish eater"],
            "Reindeer eat plants, so they are plant eaters, also called herbivores.",
        )
        vs.c(
            "The reindeer eat 2 bags of hay each day. How many bags for 2 days?",
            "4",
            ["2", "6"],
            "2 bags each day for 2 days is 2 + 2 = 4 bags.",
        )
        vs.c(
            "Which food is best for a reindeer: lichen, chocolate, or pizza?",
            "Lichen",
            ["Chocolate", "Pizza"],
            "Lichen is a plant food that reindeer eat in the wild. Chocolate and pizza are for "
            "people.",
        )
        hints = ["Reindeer are plant eaters.", "Choose a food that grows from the ground."]
    else:
        vs.c(
            "In winter, what is the main food reindeer find under the snow?",
            "Lichen",
            ["Fish", "Berries only", "Insects"],
            "Lichen, sometimes called reindeer moss, is the main winter food of reindeer. They "
            "sniff it out and dig for it.",
        )
        vs.a(
            "div",
            (12, 3),
            "We have {0} handfuls of lichen. We share them equally among {1} reindeer. How many "
            "handfuls does each reindeer get?",
            "{0} shared into {1} equal groups gives {r} each. We can check: {r} x {1} = {0}.",
            extra=(9, 15),
            deltas=(1, -1, 2),
        )
        vs.a(
            "mul",
            (4, 3),
            "Each reindeer eats {0} handfuls of lichen a day. For {1} reindeer, how many handfuls "
            "do we need for one day?",
            "{1} reindeer with {0} handfuls each need {1} x {0} = {r} handfuls.",
            extra=(7, 6),
            deltas=(1, -1, 2),
        )
        vs.c(
            "Why do we bring plant food, not candy, for reindeer?",
            "Their bodies are made to digest plants",
            ["Candy is too heavy", "Reindeer cannot see candy", "Candy is too cold"],
            "Reindeer digest plants like lichen and grass. Sugary sweets are not what their bodies "
            "are made for.",
        )
        vs.c(
            "Which animal group does a reindeer belong to?",
            "Plant eaters (herbivores)",
            ["Meat eaters (carnivores)", "Insect eaters", "Fish eaters"],
            "Reindeer eat plants, so they are herbivores.",
        )
        hints = [
            "Think about what a plant eater needs.",
            "For equal sharing, use division. For equal groups, use multiplication.",
        ]
    return _quiz(
        vs,
        "SAMPLES",
        "LIFE_SCIENCE",
        {"SPROUT": "animal-science", "PATHFINDER": "animal-science", "EXPLORER": "animal-science"}[
            band
        ],
        hints,
    )


# --- 16 np-ginger-shapes ---------------------------------------------------------------------


def _ginger_shapes(band):
    vs = _Vs("np-ginger-shapes", band)
    ss = {
        "Circle": "circle",
        "Square": "square",
        "Triangle": "triangle",
        "Heart": "heart",
        "Star": "star",
        "Hexagon": "hexagon",
    }
    if band == "SPROUT":
        vs.c(
            "Which gingerbread window is a circle?",
            "Circle",
            ["Square", "Triangle"],
            "A circle is round with no corners.",
            ss,
        )
        vs.c(
            "Which cookie is a triangle?",
            "Triangle",
            ["Circle", "Square"],
            "A triangle has 3 sides and 3 corners.",
            ss,
        )
        vs.c(
            "Which door is a square?",
            "Square",
            ["Triangle", "Circle"],
            "A square has 4 equal sides.",
            ss,
        )
        vs.c(
            "Which cookie is a star?",
            "Star",
            ["Heart", "Circle"],
            "A star has pointy tips. The star cookie has them.",
            ss,
        )
        vs.c(
            "Which cookie is a heart?",
            "Heart",
            ["Star", "Square"],
            "A heart has two round bumps on top and a point at the bottom.",
            ss,
        )
        hints = ["Look at the shapes on the cards.", "Does it have corners or is it round?"]
    elif band == "PATHFINDER":
        vs.c(
            "Which shape has 4 equal sides?",
            "Square",
            ["Triangle", "Circle"],
            "A square has 4 sides that are all the same length.",
            ss,
        )
        vs.c(
            "A gingerbread roof has 3 straight sides. Which shape is it?",
            "Triangle",
            ["Square", "Circle"],
            "3 straight sides mean a triangle.",
            ss,
        )
        vs.c(
            "Which shape has 6 sides?",
            "Hexagon",
            ["Square", "Triangle"],
            "A hexagon has 6 sides. Bees make their honeycomb with hexagons.",
            ss,
        )
        vs.c(
            "A window has 4 sides. Two are long and two are short. Which shape is it?",
            "Rectangle",
            ["Triangle", "Circle"],
            "A rectangle has 4 sides, with 2 long sides and 2 short sides.",
            {"Rectangle": "square", "Triangle": "triangle", "Circle": "circle"},
        )
        vs.c(
            "How many corners does a square have?",
            "4",
            ["3", "5"],
            "A square has 4 corners, one for each side.",
        )
        hints = ["Count the sides.", "Check if the sides are the same length."]
    else:
        vs.c(
            "Which shape has 4 equal sides and 4 square corners?",
            "Square",
            ["Rectangle", "Triangle", "Pentagon"],
            "A square is the shape with 4 equal sides and 4 square corners. A rectangle has 2 "
            "pairs of sides, not all equal.",
        )
        vs.c(
            "Which shape has 5 sides?",
            "Pentagon",
            ["Hexagon", "Square", "Triangle"],
            "A pentagon has 5 sides. Penta means five.",
        )
        vs.c(
            "A gumdrop is shaped like a ball. What is the 3D shape called?",
            "A sphere",
            ["A cube", "A cone", "A cylinder"],
            "A sphere is round like a ball in every direction.",
        )
        vs.c(
            "A gift box has 6 flat square faces. What shape is it?",
            "A cube",
            ["A sphere", "A cone", "A pyramid"],
            "A cube has 6 equal square faces and 12 edges.",
        )
        vs.c(
            "How many corners does a rectangle have?",
            "4",
            ["2", "3", "6"],
            "A rectangle has 4 sides and 4 corners.",
        )
        hints = [
            "Count the sides and look at their lengths.",
            "A 3D shape has faces, edges and corners.",
        ]
    return _quiz(vs, "SHAPES", "MATHEMATICS", "shapes", hints)


# --- 17 np-ginger-symmetry -------------------------------------------------------------------


def _ginger_symmetry(band):
    vs = _Vs("np-ginger-symmetry", band)
    if band == "SPROUT":
        vs.a(
            "id",
            (2,),
            "The left half of the window has 2 red candies. The right half must match. How many "
            "red candies go on the right?",
            "Matching sides look the same, so the right side needs {r} too.",
            lo=1,
            hi=5,
            deltas=(1, -1, 2, -2),
        )
        vs.a(
            "id",
            (3,),
            "The left wing of a cookie butterfly has 3 dots. The right wing is the same. How many "
            "dots?",
            "A matching wing has the same dots, so {r}.",
            lo=1,
            hi=5,
            deltas=(1, -1, 2, -2),
        )
        vs.c(
            "The left side of a heart cookie has a bump. Where does the matching bump go?",
            "On the right side",
            ["On the bottom", "Nowhere"],
            "A heart looks the same on both sides, so the bump goes on the right too.",
        )
        vs.c(
            "A window has a blue star on the left. What goes on the right to match?",
            "A blue star",
            ["A red heart", "A green square"],
            "To match, we copy the same thing on the other side.",
        )
        hints = ["Look at the left side and copy it.", "Matching sides look just the same."]
    elif band == "PATHFINDER":
        vs.c(
            "The left half of a window has 3 green gumdrops and 1 red one. What goes on the right "
            "to match?",
            "3 green and 1 red",
            ["1 green and 3 red", "4 red"],
            "A mirror twin copies the left side exactly.",
        )
        vs.c(
            "A folded paper heart has both halves the same. How many halves match when you fold?",
            "2",
            ["1", "3"],
            "Folding a heart down the middle gives 2 halves that fit on each other.",
        )
        vs.c(
            "Which shape looks the same on both sides when you fold it down the middle?",
            "A heart",
            ["A curly squiggle", "A lopsided blob"],
            "A heart has two matching halves. A squiggle and a blob do not.",
            {"A heart": "heart", "A curly squiggle": "moon", "A lopsided blob": "star"},
        )
        vs.c(
            "The left side of a house has 2 windows and 1 door at the edge. The right side should "
            "match. How many windows?",
            "2 windows",
            ["1 window", "4 windows"],
            "The right side copies the left, so it has 2 windows.",
        )
        vs.c(
            "Which letter looks the same when you fold it in half down the middle: A or F?",
            "A",
            ["F", "Both"],
            "A has matching left and right halves. F does not.",
        )
        hints = [
            "Copy what you see on the left to the right.",
            "Fold it in your mind. Do the halves fit?",
        ]
    else:
        vs.c(
            "How many lines of symmetry does a square have?",
            "4",
            ["1", "2", "3"],
            "A square can be folded top to bottom, side to side, and along both diagonals. That is "
            "4 lines.",
        )
        vs.c(
            "How many lines of symmetry does a rectangle that is not a square have?",
            "2",
            ["1", "4", "0"],
            "A rectangle folds in half one way and the other way, but not along its diagonals. "
            "That is 2 lines.",
        )
        vs.c(
            "How many lines of symmetry does a heart have?",
            "1",
            ["0", "2", "4"],
            "A heart folds in half down the middle only. That is 1 line.",
        )
        vs.c(
            "Which of these has a line of symmetry?",
            "The letter A",
            ["The letter F", "The letter R", "The letter G"],
            "The letter A has matching left and right halves. F, R and G do not.",
        )
        vs.c(
            "A snowflake has the same pattern in each of its 6 arms. What does this tell us?",
            "It is symmetrical",
            ["It is crooked", "It is flat", "It is a circle"],
            "When the same pattern repeats around, a snowflake is symmetrical.",
        )
        hints = [
            "Imagine folding the shape so both halves fit exactly.",
            "Try each fold: top to bottom, left to right, and across the corners.",
        ]
    return _quiz(vs, "SHAPES", "MATHEMATICS", "symmetry", hints)


# --- 18 np-ginger-recipe ---------------------------------------------------------------------


def _ginger_recipe(band):
    vs = _Vs("np-ginger-recipe", band)
    if band == "SPROUT":
        vs.c(
            "Mrs. Claus says: stir the dough. Which tool do we use to stir?",
            "Spoon",
            ["Sock", "Boot"],
            "A spoon helps us stir the dough.",
            {"Spoon": "moon", "Sock": "square", "Boot": "triangle"},
        )
        vs.c(
            "Mrs. Claus says: roll the dough flat. What do we use?",
            "Rolling pin",
            ["Teddy bear", "Hat"],
            "A rolling pin is a long tool that flattens the dough.",
        )
        vs.c(
            "Mrs. Claus says: put the cookies in the oven. Where do they go?",
            "In the oven",
            ["In the sink", "On the roof"],
            "The oven is warm and bakes the cookies. A grown-up helps with the oven.",
        )
        vs.c(
            "Which is the sweet part of a gingerbread cookie?",
            "Sugar",
            ["Salt water", "Snow"],
            "Sugar makes cookies sweet.",
        )
        hints = ["Listen to the words in the recipe.", "Think about what the tool does."]
    elif band == "PATHFINDER":
        vs.c(
            "The recipe says: Mix flour and sugar. Add one egg. Bake for ten minutes. What do you "
            "add to the flour and sugar?",
            "One egg",
            ["Ten eggs", "A spoon"],
            "The card says add one egg after we mix the flour and sugar.",
        )
        vs.c(
            "The recipe says: Stir the dough. Roll it flat. Cut out the shapes. What do you do "
            "after you roll the dough flat?",
            "Cut out the shapes",
            ["Stir the dough", "Eat the dough"],
            "The steps go in order. After rolling flat we cut the shapes.",
        )
        vs.c(
            "The recipe says: Bake the cookies for ten minutes. How long do they bake?",
            "Ten minutes",
            ["One minute", "One hour"],
            "The card says ten minutes.",
        )
        vs.c(
            "The recipe says: Add two spoons of ginger. How many spoons of ginger?",
            "Two",
            ["One", "Three"],
            "The word two on the card means 2 spoons.",
        )
        vs.c(
            "The recipe says: Let the cookies cool, then add icing. What do you add last?",
            "Icing",
            ["Flour", "Eggs"],
            "The word then tells us icing comes after cooling.",
        )
        hints = ["Read the card one line at a time.", "Find the word in the question on the card."]
    else:
        vs.c(
            "Mrs. Claus's card: Heat the oven to 180 degrees. Mix 2 cups of flour with 1 cup of "
            "sugar. Add 1 egg and stir well. How many cups of flour do we need?",
            "2 cups",
            ["1 cup", "3 cups", "180 cups"],
            "The card says 2 cups of flour. 1 cup is the sugar, and 180 is the oven heat.",
        )
        vs.c(
            "Card: Roll the dough until it is 1 cm thick. Cut out 12 gingerbread men. Bake for 10 "
            "minutes. How many cookies will we cut?",
            "12",
            ["1", "10", "22"],
            "The card says to cut 12 gingerbread men.",
        )
        vs.c(
            "Card: Add the icing only after the cookies have cooled. Why do we wait?",
            "Hot cookies would melt the icing",
            ["Icing needs sunlight", "Cookies are too small", "The card is long"],
            "Warm cookies melt icing, so we wait until they are cool.",
        )
        vs.c(
            "Card: Use 3 cups of flour for one batch. How many cups for 2 batches?",
            "6 cups",
            ["5 cups", "3 cups", "9 cups"],
            "Two batches need 3 + 3 = 6 cups of flour, or 2 x 3.",
        )
        vs.c(
            "Card: Mix the flour and ginger. Next, add the egg. Last, stir in the milk. What do we "
            "add after the egg?",
            "The milk",
            ["The ginger", "The flour", "The icing"],
            "The card says last, stir in the milk, so milk comes after the egg.",
        )
        hints = [
            "Read the card first, then read the question.",
            "Find the exact number or word you need in the card.",
        ]
    return _quiz(
        vs,
        "CARDS",
        "LITERACY",
        {
            "SPROUT": "following-directions",
            "PATHFINDER": "following-directions",
            "EXPLORER": "reading-comprehension",
        }[band],
        hints,
    )


# --- 19 np-ginger-measure --------------------------------------------------------------------


def _ginger_measure(band):
    vs = _Vs("np-ginger-measure", band)
    if band == "SPROUT":
        vs.c(
            "Which candy cane is longer?",
            "The long one",
            ["The short one"],
            "The long candy cane stretches farther than the short one.",
        )
        vs.c(
            "Which gingerbread man is shorter?",
            "The small one",
            ["The big one"],
            "Shorter means not as tall. The small one is shorter.",
        )
        vs.c(
            "Which ribbon is longer?",
            "The long ribbon",
            ["The tiny ribbon"],
            "The long ribbon is longer than the tiny one.",
        )
        vs.c(
            "Which house is taller?",
            "The tall house",
            ["The short house"],
            "The tall house reaches higher.",
        )
        hints = ["Line them up side by side.", "Which one reaches farther?"]
    elif band == "PATHFINDER":
        vs.a(
            "sub",
            (6, 4),
            "A ribbon is 6 paper clips long. Another is 4 paper clips long. How many more paper "
            "clips long is the first ribbon?",
            "6 take away 4 is {r}. The first ribbon is {r} paper clips longer.",
            lo=1,
            hi=10,
            deltas=(1, -1, 2),
        )
        vs.c(
            "A candy cane is 5 blocks long. A gingerbread man is 8 blocks long. Which is longer?",
            "The gingerbread man",
            ["The candy cane", "They are the same"],
            "8 blocks is more than 5 blocks, so the gingerbread man is longer.",
        )
        vs.a(
            "add",
            (3, 4),
            "A roof is 3 cookies wide. A wall is 4 cookies wide. Put them end to end. How many "
            "cookies long is that?",
            "3 and 4 make {r} cookies.",
            deltas=(1, -1, 2),
        )
        vs.c(
            "Which is the best way to measure the length of a table: your feet or a cup?",
            "Your feet",
            ["A cup", "A feather"],
            "We measure length with things that have length, like feet or a ruler.",
        )
        vs.a(
            "sub",
            (9, 5),
            "A gingerbread fence is 9 cookies long. 5 cookies are painted. How many cookies are "
            "not painted?",
            "9 minus 5 is {r}.",
            deltas=(1, -1, 2),
        )
        hints = ["Line things up and compare.", "Use the same unit for everything."]
    else:
        vs.a(
            "sub",
            (30, 12),
            "A gingerbread house is {0} cm tall. A cookie tree is {1} cm tall. How much taller is "
            "the house?",
            "30 minus 12 is {r}, so the house is {r} cm taller.",
            deltas=(2, -2, 10, 1),
        )
        vs.c(
            "Which is the best unit to measure the length of a gingerbread cookie?",
            "Centimetres",
            ["Metres", "Kilometres", "Litres"],
            "A cookie is small, so we use centimetres. Metres are better for longer things.",
        )
        vs.a(
            "add",
            (45, 55),
            "A fence has two parts. One is {0} cm long and the other is {1} cm long. How long is "
            "the fence?",
            "45 + 55 = {r} cm. That is exactly 1 metre, because 100 cm is 1 m.",
            extra=(90, 105),
            deltas=(10, -10, 5),
        )
        vs.c(
            "A ribbon is 2 m long. How many centimetres is that?",
            "200 cm",
            ["20 cm", "2 cm", "2000 cm"],
            "1 metre is 100 centimetres, so 2 metres is 200 centimetres.",
        )
        vs.c(
            "Mrs. Claus has a ribbon 40 cm long and a ribbon 52 cm long. Which is longer, and by "
            "how much?",
            "The 52 cm ribbon, by 12 cm",
            ["The 40 cm ribbon, by 12 cm", "The 52 cm ribbon, by 92 cm", "They are the same"],
            "52 is more than 40. The difference is 52 minus 40 = 12 cm.",
        )
        hints = [
            "Make sure both lengths use the same unit.",
            "To find how much longer, subtract the shorter from the longer.",
        ]
    return _quiz(
        vs,
        "SAMPLES",
        "MATHEMATICS",
        {
            "SPROUT": "comparing-lengths",
            "PATHFINDER": "comparing-lengths",
            "EXPLORER": "measurement",
        }[band],
        hints,
    )


# --- 21 np-mountain-weather ------------------------------------------------------------------


def _mountain_weather(band):
    vs = _Vs("np-mountain-weather", band)
    if band == "SPROUT":
        vs.c(
            "Is snow cold or hot?",
            "Cold",
            ["Hot", "Warm like a bath"],
            "Snow is frozen water, so it feels cold.",
        )
        vs.c(
            "What happens to ice in the warm sun?",
            "It melts",
            ["It grows", "It sings"],
            "Warm air makes ice melt into water.",
        )
        vs.c(
            "What falls from clouds in winter?",
            "Snow",
            ["Toys", "Hats"],
            "In cold weather, snow falls from clouds.",
        )
        vs.c(
            "What do we wear on a snowy day?",
            "A warm coat",
            ["A swimsuit", "Sandals"],
            "A coat keeps us warm in the cold.",
        )
        hints = ["Think about how snow feels.", "Think about what warmth does to ice."]
    elif band == "PATHFINDER":
        vs.c(
            "When ice gets warm, what does it turn into?",
            "Water",
            ["Rock", "Sand"],
            "Ice is frozen water. When it warms up, it melts back into water.",
        )
        vs.c(
            "What happens to water when it gets very cold?",
            "It freezes into ice",
            ["It turns into sand", "It disappears"],
            "Cold takes warmth away from the water until it freezes into ice.",
        )
        vs.c(
            "Where does snow come from?",
            "From clouds",
            ["From the ground", "From the sun"],
            "Snow forms high up in cold clouds and falls to the ground.",
        )
        vs.c(
            "Which one is a solid?",
            "Ice",
            ["Rain", "Steam"],
            "Ice keeps its shape. Rain is a liquid and steam is a gas.",
        )
        vs.c(
            "Which is the best coat for a snowy day?",
            "A thick warm one",
            ["A thin T-shirt", "A raincoat only"],
            "A thick coat keeps in body warmth.",
        )
        hints = ["Think about warm and cold.", "Remember that ice and water are the same stuff."]
    else:
        vs.c(
            "Water freezes into ice. What happens when ice gets warmer than 0 degrees Celsius?",
            "It melts into water",
            ["It turns to sand", "It turns to steam at once", "It stays the same"],
            "Above 0 degrees Celsius, ice melts back into liquid water.",
        )
        vs.c(
            "How many sides or arms does a snowflake have?",
            "6",
            ["4", "5", "8"],
            "Snowflakes grow in a six-sided shape, so they have 6 arms.",
        )
        vs.c(
            "Which three states can water be in?",
            "Solid, liquid and gas",
            ["Hot, warm and cold", "Big, medium and small", "Rock, sand and soil"],
            "Water can be ice (solid), water (liquid) or steam (gas).",
        )
        vs.c(
            "A puddle outside freezes overnight. What does that tell us about the air temperature?",
            "It dropped below 0 degrees Celsius",
            ["It was very hot", "It stayed at 20 degrees", "It is windy"],
            "Water freezes at 0 degrees Celsius, so the air must have been colder than that.",
        )
        vs.c(
            "Why does a snowman melt on a sunny day?",
            "The sun warms the snow so it melts",
            ["The snowman gets scared", "The wind pulls it apart", "Snow is a plant"],
            "Warmth from the sun turns the ice crystals into liquid water.",
        )
        hints = [
            "Think about the three states of water.",
            "Temperature tells us if water freezes or melts.",
        ]
    return _quiz(
        vs,
        "CARDS",
        "EARTH_SCIENCE",
        {"SPROUT": "observation", "PATHFINDER": "cause-and-effect", "EXPLORER": "cause-and-effect"}[
            band
        ],
        hints,
    )


# --- 22 np-obs-stars -------------------------------------------------------------------------


def _obs_stars(band):
    vs = _Vs("np-obs-stars", band)
    if band == "SPROUT":
        vs.c(
            "What twinkles in the night sky?",
            "Stars",
            ["Cars", "Cups"],
            "Stars shine like tiny lights in the night sky.",
        )
        vs.c(
            "When can we see stars best?",
            "At night",
            ["At lunch", "At breakfast"],
            "The sky is dark at night, so stars are easy to see.",
        )
        vs.c(
            "What shines in the day sky and warms us?",
            "The sun",
            ["The moon", "A star toy"],
            "The sun is bright and warm, and it lights up the day.",
        )
        vs.c(
            "Stars come out when the sky is...",
            "Dark",
            ["Bright", "Full of rain"],
            "We see stars best when the sky is dark.",
        )
        hints = ["Think about what you see when it is dark.", "Look up at the sky."]
    elif band == "PATHFINDER":
        vs.c(
            "The Sun is a...",
            "Star",
            ["Planet", "Moon"],
            "The Sun is a star. It is the star closest to Earth.",
        )
        vs.c(
            "When do the stars come out?",
            "When the sky gets dark",
            ["At noon", "When it rains"],
            "The stars are there all the time, but we see them best when the sky is dark.",
        )
        vs.c(
            "Which one gives us light and warmth in the day?",
            "The Sun",
            ["The Moon", "The stars"],
            "The Sun is a star, and it gives light and warmth.",
        )
        vs.c(
            "How many stars can you see on a very dark night?",
            "Many",
            ["None", "Only one"],
            "A dark sky shows thousands of stars.",
        )
        vs.c(
            "Which star is bigger and brighter to us?",
            "The Sun",
            ["A far-away star", "A firefly"],
            "The Sun looks big because it is close. Other stars are very far away.",
        )
        hints = ["Remember the Sun is a star too.", "Stars show up best in the dark."]
    else:
        vs.c(
            "Why can we not see stars during the day?",
            "The Sun is so bright it hides their light",
            ["The stars go to sleep", "The stars switch off", "Clouds take the stars away"],
            "The stars are still there. The bright light of the Sun fills the sky and hides them.",
        )
        vs.c(
            "What kind of object is the Sun?",
            "A star",
            ["A planet", "A moon", "A comet"],
            "The Sun is a star, a ball of hot glowing gas.",
        )
        vs.c(
            "Polaris, the North Star, is special because it...",
            "Stays in nearly the same place in the northern sky",
            ["Moves across the sky quickly", "Is the closest star", "Is the biggest star"],
            "Polaris sits almost straight above the North Pole, so it appears to stay in nearly "
            "the same place while other stars seem to circle around it.",
        )
        vs.c(
            "When do stars appear in the sky?",
            "As the sky gets dark",
            ["As the sky gets bright", "Only in winter", "Only when it is cloudy"],
            "Stars appear as the Sun sets and the sky darkens.",
        )
        vs.c(
            "Why do stars look so tiny to us?",
            "They are very far away",
            ["They are small like pebbles", "They are made of glass", "They are hiding"],
            "Stars are huge balls of gas, but they are so far away that they look like tiny dots.",
        )
        hints = [
            "Think about what the Sun is.",
            "Remember that the stars are always there, even in the day.",
        ]
    return _quiz(
        vs,
        "CARDS",
        "EARTH_SCIENCE",
        {"SPROUT": "observation", "PATHFINDER": "cause-and-effect", "EXPLORER": "earth-and-space"}[
            band
        ],
        hints,
    )


# --- 23 np-obs-constellation -----------------------------------------------------------------


def _obs_constellation(band):
    vs = _Vs("np-obs-constellation", band)
    ss = {
        "Triangle": "triangle",
        "Circle": "circle",
        "Square": "square",
        "Star": "star",
        "Moon": "moon",
        "Heart": "heart",
    }
    if band == "SPROUT":
        vs.c(
            "Join the dots of three stars. Which shape do you make?",
            "Triangle",
            ["Circle", "Square"],
            "Three dots joined by lines make a triangle.",
            ss,
        )
        vs.c(
            "Join the dots of four stars at the corners. Which shape do you make?",
            "Square",
            ["Circle", "Triangle"],
            "Four corner dots joined make a square.",
            ss,
        )
        vs.c(
            "Stars can make a picture in the sky. What do we call it?",
            "A picture of stars",
            ["A picture of cheese", "A picture of rain"],
            "People join stars with lines to make pictures.",
        )
        vs.c(
            "Which one looks like a crescent in the night sky?",
            "Moon",
            ["Heart", "Square"],
            "A crescent moon is a thin curve of light.",
            ss,
        )
        hints = ["Connect the dots in your mind.", "Count how many dots there are."]
    elif band == "PATHFINDER":
        vs.c(
            "The Big Dipper looks like a big...",
            "Spoon with a long handle",
            ["Boat", "Tree"],
            "The Big Dipper looks like a big spoon, with a bowl and a long handle.",
        )
        vs.c(
            "How many bright stars are in the Big Dipper?",
            "7",
            ["3", "12"],
            "The Big Dipper has 7 bright stars.",
        )
        vs.c(
            "What do we call a group of stars that make a picture?",
            "A constellation",
            ["A galaxy", "A comet"],
            "A constellation is a group of stars that people see as a picture.",
        )
        vs.c(
            "The Big Dipper helps us find...",
            "The North Star",
            ["The Moon", "The Sun"],
            "Two stars in the Big Dipper point toward Polaris, the North Star.",
        )
        vs.c(
            "How many stars in the handle and bowl together?",
            "7",
            ["5", "9"],
            "The bowl has 4 stars and the handle has 3, so 7 in all.",
        )
        hints = [
            "Remember the shape of a big spoon.",
            "Count the stars in the bowl and the handle.",
        ]
    else:
        vs.c(
            "How many bright stars make up the Big Dipper?",
            "7",
            ["5", "9", "12"],
            "The Big Dipper has 7 bright stars: 4 in its bowl and 3 in its handle.",
        )
        vs.c(
            "The two end stars of the Big Dipper's bowl point toward which star?",
            "Polaris, the North Star",
            ["The Sun", "Sirius", "The Moon"],
            "If you follow the line from the bowl's two end stars, you reach Polaris.",
        )
        vs.c(
            "The Big Dipper is part of a bigger constellation. What is that constellation called?",
            "Ursa Major, the Great Bear",
            ["Orion, the Hunter", "The Sun", "The Moon"],
            "The Big Dipper is a well-known star pattern inside the larger constellation Ursa "
            "Major, the Great Bear.",
        )
        vs.c(
            "Why was Polaris useful to travellers long ago?",
            "It stays in nearly the same place, showing north",
            ["It moves in a circle", "It is the Sun", "It is the brightest object in the sky"],
            "Polaris is almost over the North Pole, so it shows the direction north.",
        )
        vs.c(
            "A constellation is...",
            "A pattern of stars people see as a picture",
            ["A planet with rings", "A very large star", "A kind of moon"],
            "A constellation is a pattern of stars that people connect, like drawing with dots.",
        )
        hints = [
            "Remember the shape of a big spoon.",
            "Count the stars in the bowl, then in the handle.",
        ]
    return _quiz(
        vs,
        "SHAPES",
        "EARTH_SCIENCE",
        {"SPROUT": "shapes", "PATHFINDER": "observation", "EXPLORER": "earth-and-space"}[band],
        hints,
    )


# --- 24 np-obs-sequence ----------------------------------------------------------------------


def _obs_sequence(band):
    vs = _Vs("np-obs-sequence", band)
    if band == "SPROUT":
        vs.o(
            "What happens first? Put them in order: the sun is up, the sun goes down, the stars "
            "come out.",
            [("sun-up", "Sun is up"), ("sun-down", "Sun goes down"), ("stars", "Stars come out")],
            "In a day, the sun is up first. Then it goes down, and then the stars appear.",
        )
        vs.o(
            "Put the day in order: morning, afternoon, night.",
            [("morning", "Morning"), ("afternoon", "Afternoon"), ("night", "Night")],
            "Morning, afternoon, then night is the order of a day.",
        )
        vs.o(
            "Put in order: bright day, getting dark, dark night.",
            [("bright", "Bright day"), ("getting-dark", "Getting dark"), ("dark", "Dark night")],
            "The sky gets darker as the day turns into night.",
        )
        hints = [
            "Think about what you see first in the day.",
            "Which comes last when the sky is dark?",
        ]
    elif band == "PATHFINDER":
        vs.o(
            "Put the sky changes in order: bright blue sky, orange sunset, dark blue sky, stars "
            "shine.",
            [
                ("blue", "Bright blue sky"),
                ("sunset", "Orange sunset"),
                ("dark", "Dark blue sky"),
                ("stars", "Stars shine"),
            ],
            "Day light fades into sunset colours. When the sky is dark, the stars show.",
        )
        vs.o(
            "Put the night in order: the sun sets, the sky turns dark, the first star appears, "
            "many stars twinkle.",
            [
                ("sets", "The sun sets"),
                ("dark", "The sky turns dark"),
                ("first", "The first star appears"),
                ("many", "Many stars twinkle"),
            ],
            "As the sky gets darker, first one star and then many appear.",
        )
        vs.o(
            "Put in order: wake up, sun is high, sunset, moon rises.",
            [
                ("wake", "Wake up"),
                ("high", "Sun is high"),
                ("sunset", "Sunset"),
                ("moon", "Moon rises"),
            ],
            "The day goes from morning to noon, evening, and night.",
        )
        vs.o(
            "Put in order: stars fade, sky gets light, sun rises, bright morning.",
            [
                ("fade", "Stars fade"),
                ("light", "Sky gets light"),
                ("rise", "Sun rises"),
                ("bright", "Bright morning"),
            ],
            "At dawn the sky lightens and the stars seem to fade as the sun comes up.",
        )
        hints = [
            "Think about what the sky looks like as the day goes by.",
            "Which happens right after the sun sets?",
        ]
    else:
        vs.o(
            "Put the evening in order: the Sun sets, the sky turns orange, the sky turns deep "
            "blue, the first bright star appears, many stars appear.",
            [
                ("set", "The Sun sets"),
                ("orange", "The sky turns orange"),
                ("blue", "The sky turns deep blue"),
                ("first", "The first bright star appears"),
                ("many", "Many stars appear"),
            ],
            "As the Sun goes down, the sky changes colour and gets darker. Stars appear as the sky "
            "darkens.",
        )
        vs.o(
            "Put the night in order: dusk, first star, full dark sky with many stars, the Big "
            "Dipper turns slowly around Polaris, dawn.",
            [
                ("dusk", "Dusk"),
                ("first", "First star"),
                ("dark", "Dark sky full of stars"),
                ("turn", "Big Dipper turns around Polaris"),
                ("dawn", "Dawn"),
            ],
            "Through the night the stars seem to turn slowly around Polaris, and at dawn the light "
            "returns.",
        )
        vs.o(
            "Put in order: We look up. We see the Big Dipper. We follow the end stars of its bowl. "
            "We find Polaris.",
            [
                ("look", "We look up"),
                ("see", "We see the Big Dipper"),
                ("follow", "We follow the end stars"),
                ("find", "We find Polaris"),
            ],
            "We find the Big Dipper first, then follow its pointer stars to Polaris.",
        )
        vs.o(
            "Put the day in order: sunrise, noon, afternoon, sunset, starry night.",
            [
                ("rise", "Sunrise"),
                ("noon", "Noon"),
                ("afternoon", "Afternoon"),
                ("sunset", "Sunset"),
                ("night", "Starry night"),
            ],
            "The Sun moves across the sky from sunrise to sunset, and stars appear after dark.",
        )
        hints = [
            "Find the first event, then look for what comes right after.",
            "Words like then, next and last can help.",
        ]
    return _quiz(
        vs,
        "STORY",
        "EARTH_SCIENCE",
        "cause-and-effect" if band != "SPROUT" else "sequencing",
        hints,
    )


# --- 25 np-obs-fragments (ring of 6 sockets; the village fragment is the centre piece) ---------

JOURNEY = (
    ("workshop", "Toy Workshop fragment"),
    ("forest", "Candy Cane Forest fragment"),
    ("lake", "Frozen Lake fragment"),
    ("stables", "Reindeer Stables fragment"),
    ("gingerbread", "Gingerbread House fragment"),
    ("mountain", "Snowflake Mountain fragment"),
)


def _obs_fragments(band):
    vs = _Vs("np-obs-fragments", band)
    maps = ENTITY_MAPS["np-obs-fragments"][band]["itemEntities"]
    journey = [(k, label) for k, label in JOURNEY if k in maps]
    if band == "SPROUT":
        vs.o(
            "Jingle set the first star piece in the middle. Now set the next three in the order we "
            "found them: workshop, forest, lake.",
            journey,
            "We found them in this order: the workshop, then the forest, then the lake.",
        )
        vs.o(
            "Follow our trip on the map. Start at the workshop, then go to the forest, then the "
            "lake.",
            journey,
            "We follow the path of our journey, one place after another.",
        )
        vs.o(
            "Set the star pieces in order. First the workshop, next the forest, last the lake.",
            journey,
            "The words first, next and last tell us the order.",
        )
        hints = ["Remember the places we went first.", "Start with the workshop."]
    elif band == "PATHFINDER":
        vs.o(
            "Jingle set the village fragment in the middle. Now set the other six in the order of "
            "our journey. Start with the Toy Workshop.",
            journey,
            "Our journey went from the workshop to the forest, the lake, the stables, the "
            "gingerbread house and the mountain.",
        )
        vs.o(
            "Set the star pieces in the order we found them on our trip, first to last.",
            journey,
            "We found them one place at a time. The mountain piece came last.",
        )
        vs.o(
            "Look at the map trail. Set the fragments in the order we walked the trail.",
            journey,
            "The map trail goes from the workshop to the mountain, and the pieces follow the same "
            "order.",
        )
        hints = [
            "We began in the village and went to the workshop next.",
            "The mountain was the last place we went.",
        ]
    else:
        vs.o(
            "Jingle set the village fragment in the middle. Set the six other fragments in the "
            "order of our journey, from the first place to the last.",
            journey,
            "The journey order is the workshop, forest, lake, stables, gingerbread house, then the "
            "mountain.",
        )
        reverse = list(reversed(journey))
        vs.o(
            "Set the six fragments in order starting from the last place we visited and going back "
            "to the first.",
            reverse,
            "Going backwards: the mountain, gingerbread house, stables, lake, forest, then the "
            "workshop.",
        )
        vs.o(
            "Set the fragments in the order we visited the places on the way to the star, first to "
            "last.",
            journey,
            "Retelling the trip in order helps us remember: workshop, forest, lake, stables, "
            "gingerbread house, mountain.",
        )
        hints = [
            "Retell our trip from the start in your head.",
            "The mountain was the last place we went before the observatory.",
        ]
    return _quiz(vs, "CRYSTALS", "LOGIC", "sequencing", hints, itemEntities=maps)


# --- 26 np-obs-final -------------------------------------------------------------------------


def _obs_final(band):
    vs = _Vs("np-obs-final", band)
    if band == "SPROUT":
        for n, thing in (
            (3, "shiny stars"),
            (4, "glowing crystals"),
            (5, "twinkling lights"),
            (2, "silver bells"),
            (4, "snowflakes"),
        ):
            vs.a(
                "id",
                (n,),
                "Polaris counts {0} "
                + thing
                + " around the big star. How many "
                + thing
                + " are there?",
                "Touching each one and counting gives {r}. The last number we say is how many.",
                lo=1,
                hi=5,
                deltas=(1, -1, 2, -2),
            )
        hints = ["Count them one at a time.", "The last number you say is the answer."]
    elif band == "PATHFINDER":
        for k in (3, 5, 2, 6, 4):
            vs.a(
                "sub",
                (7, k),
                "We found {0} star fragments. {1} are set in the star. How many more must we set?",
                "7 take away {1} leaves {r}. That many fragments are still waiting.",
                lo=0,
                hi=9,
                deltas=(1, -1, 2, -2),
            )
        vs.a(
            "add",
            (4, 5),
            "Polaris shows {0} stars on one side of the sky and {1} on the other. How many stars "
            "is that in all?",
            "{0} and {1} together make {r}.",
            deltas=(1, -1, 2, -2),
        )
        hints = [
            "Start with all the fragments and take away the ones that are set.",
            "Draw 7 dots and cross out the set ones.",
        ]
    else:
        vs.a(
            "sub3",
            (7, 3, 2),
            "We found {0} star fragments. Jingle set {1} and Tinker set {2}. How many are left to "
            "set?",
            "7 minus 3 is 4, then 4 minus 2 is {r}.",
            extra=(3, 4),
            deltas=(1, -1),
        )
        vs.a(
            "mulsub",
            (4, 6, 5),
            "Each of {0} sacks holds {1} presents. Santa takes {2} presents out. How many presents "
            "are left?",
            "{0} sacks with {1} presents each are {0} x {1} = 24. Then 24 - {2} = {r}.",
            extra=(24, 29, 15),
            deltas=(1, -1),
        )
        vs.a(
            "addmul",
            (3, 2, 2),
            "The star needs 7 fragments. We have {0}. Each of {2} elves brings {1} more. How many "
            "fragments do we have now?",
            "{2} elves with {1} each bring {2} x {1} = 4. Then {0} + 4 = {r}.",
            extra=(5, 10, 9),
            deltas=(1, -1),
        )
        vs.a(
            "divsub",
            (20, 4, 3),
            "{0} lights are shared equally among {1} trees. Then {2} lights fall off one tree. How "
            "many lights does that tree have now?",
            "{0} divided by {1} is 5. Then 5 - {2} = {r}.",
            extra=(5, 8, 17),
            deltas=(1, -1),
        )
        vs.a(
            "submul",
            (30, 3, 9),
            "The sleigh has {0} presents. It visits {1} stops and leaves {2} presents at each. How "
            "many presents are left?",
            "{1} stops with {2} presents each use {1} x {2} = 27. Then {0} - 27 = {r}.",
            extra=(27, 21, 6),
            deltas=(1, -1),
        )
        hints = [
            "Break the problem into two small steps and do the first one.",
            "Write the answer from step one, then use it in step two.",
        ]
    skill = {
        "SPROUT": "counting-sets",
        "PATHFINDER": "subtraction-within-ten",
        "EXPLORER": "multiplication-facts",
    }[band]
    return _quiz(vs, "CARDS", "MATHEMATICS", skill, hints)


# --- observe, platforms, collect, return -----------------------------------------------------

OBSERVE_FEATURES = {
    "np-landmark-tree": (
        "Christmas tree",
        "A tall evergreen tree with lights and ornaments. Evergreen trees keep their needles all "
        "winter.",
        "The big tree stays green all winter.",
    ),
    "np-landmark-cottage": (
        "Cosy cottage",
        "A cottage with a steep roof. Snow slides off steep roofs, so it does not pile up and get "
        "too heavy.",
        "A cosy cottage with a snowy roof.",
    ),
    "np-landmark-snowman": (
        "Snowman",
        "A snowman is made of three balls of snow. Snow packs together best when it is a little "
        "wet.",
        "A snowman made of three round snowballs.",
    ),
    "np-landmark-lantern": (
        "Glowing lantern",
        "A lantern gives light in the long winter dark. Its glow shows the way along the path.",
        "A lantern glows on the path.",
    ),
    "np-landmark-gifts": (
        "Pile of gifts",
        "Wrapped gifts wait in a pile. Counting them shows how many friends will get one.",
        "A pile of wrapped gifts.",
    ),
}
OBSERVE_BAND_IDS = {
    "SPROUT": ("np-landmark-tree", "np-landmark-snowman", "np-landmark-lantern"),
    "PATHFINDER": (
        "np-landmark-tree",
        "np-landmark-snowman",
        "np-landmark-lantern",
        "np-landmark-gifts",
    ),
    "EXPLORER": tuple(OBSERVE_FEATURES),
}


def _welcome_look(band):
    explorer = band == "EXPLORER"
    return {
        "features": [
            {
                "id": entity,
                "label": OBSERVE_FEATURES[entity][0],
                "explanation": OBSERVE_FEATURES[entity][
                    1 if explorer or band == "PATHFINDER" else 2
                ],
            }
            for entity in OBSERVE_BAND_IDS[band]
        ],
        "hints": [
            "Look around the village square.",
            "Tap each glowing thing to look at it closely.",
        ],
        "hintAfterAttempts": 1 if band == "SPROUT" else 2,
    }


def _ginger_build(band):
    stone_ids = tuple(f"np-ginger-stone-{i}" for i in range(1, 4))
    slot_ids = tuple(f"np-ginger-slot-{i}" for i in range(1, 4))
    if band == "EXPLORER":
        stone_labels = ("Beam 4 cm", "Beam 8 cm", "Beam 12 cm")
        slot_labels = ("Gap 1: 4 cm wide", "Gap 2: 8 cm wide", "Gap 3: 12 cm wide")
    else:
        stone_labels = ("Short beam", "Medium beam", "Long beam")
        slot_labels = ("Small gap", "Middle gap", "Big gap")
    return {
        "stones": [
            {"id": s, "label": label, "size": size}
            for s, label, size in zip(stone_ids, stone_labels, (1, 2, 3), strict=True)
        ],
        "slots": [
            {"id": s, "label": label, "gap": size}
            for s, label, size in zip(slot_ids, slot_labels, (1, 2, 3), strict=True)
        ],
        "showOutlines": band != "EXPLORER",
        "hints": [
            "Match the size of each beam to the size of the gap.",
            "Start with the smallest gap and the smallest beam.",
        ],
        "hintAfterAttempts": 1 if band == "SPROUT" else 2,
    }


def _stables_return(band):
    return {
        "npcEntityId": "np-noel",
        "hints": ["Noel is waiting by the stables."],
        "hintAfterAttempts": 1 if band == "SPROUT" else 2,
    }


def _eve_bell(band):
    return {
        "discoveryMessage": (
            "You rang Santa's sleigh bell! Jingle, jingle, the sleigh is ready for Christmas Eve."
        ),
        "hints": ["Look for the shiny bell on Santa's sleigh."],
        "hintAfterAttempts": 1 if band == "SPROUT" else 2,
    }


# --- entity maps and entity ids --------------------------------------------------------------

# The layout workstream's ids are authoritative (north_pole_layout.PUZZLE_ENTITIES / _MAPS).
ENTITY_IDS: dict[str, list[str]] = layout.PUZZLE_ENTITIES
_LM = layout.PUZZLE_ENTITY_MAPS


def _subset(pid: str, keys) -> dict[str, str]:
    return {k: _LM[pid][k] for k in keys}


# puzzle -> band -> {optionEntities | itemEntities: {key: entity}}.
# np-lake-order: keys a..d are the floes in walking order; each variant paints its own numbers
# on them (Sprouts use a to c). np-obs-fragments: ORDER items are capped at 6, so the village
# fragment (the centre piece Jingle sets first) is not a key; Sprouts order workshop, forest and
# lake only. The village socket and any unordered sockets stay in the puzzle's entity_ids and the
# client lights them when the puzzle is solved.
ENTITY_MAPS: dict[str, dict[str, dict[str, dict[str, str]]]] = {
    "np-lake-sums": {band: {"optionEntities": dict(_LM["np-lake-sums"])} for band in BANDS},
    "np-lake-order": {
        "SPROUT": {"itemEntities": _subset("np-lake-order", "abc")},
        "PATHFINDER": {"itemEntities": _subset("np-lake-order", "abcd")},
        "EXPLORER": {"itemEntities": _subset("np-lake-order", "abcd")},
    },
    "np-obs-fragments": {
        "SPROUT": {"itemEntities": _subset("np-obs-fragments", ("workshop", "forest", "lake"))},
        "PATHFINDER": {"itemEntities": _subset("np-obs-fragments", [k for k, _ in JOURNEY])},
        "EXPLORER": {"itemEntities": _subset("np-obs-fragments", [k for k, _ in JOURNEY])},
    },
}

# --- the puzzle bodies, in contract order ----------------------------------------------------

_FRAGMENT_KEYS = [
    f"NORTH_POLE_FRAGMENT_{zone}"
    for zone in ("VILLAGE", "WORKSHOP", "FOREST", "LAKE", "STABLES", "GINGERBREAD", "MOUNTAIN")
]

# (puzzleId, kind, title, requires, key, reward, band factory)
_TABLE = [
    (
        "np-welcome-look",
        PuzzleKind.OBSERVE_FEATURES,
        "Look around the village",
        [],
        "NORTH_POLE_WELCOME_LOOKED",
        "np-rule-welcome",
        _welcome_look,
    ),
    (
        "np-workshop-count",
        CHOOSE,
        "Count the toys",
        ["NORTH_POLE_WELCOME_LOOKED"],
        "NORTH_POLE_WORKSHOP_TOYS_COUNTED",
        None,
        _workshop_count,
    ),
    (
        "np-workshop-sort",
        CHOOSE,
        "Sort the presents",
        ["NORTH_POLE_WORKSHOP_TOYS_COUNTED"],
        "NORTH_POLE_WORKSHOP_PRESENTS_SORTED",
        None,
        _workshop_sort,
    ),
    (
        "np-workshop-pattern",
        CHOOSE,
        "Fix the belt pattern",
        ["NORTH_POLE_WORKSHOP_PRESENTS_SORTED"],
        "NORTH_POLE_WORKSHOP_PATTERN_FIXED",
        None,
        _workshop_pattern,
    ),
    (
        "np-workshop-assemble",
        ORDER,
        "Assemble a toy",
        ["NORTH_POLE_WORKSHOP_GIFTS_CHECKED"],
        "NORTH_POLE_WORKSHOP_RESTORED",
        "np-rule-workshop",
        _workshop_assemble,
    ),
    (
        "np-forest-sequence",
        CHOOSE,
        "Number trail",
        ["NORTH_POLE_WORKSHOP_RESTORED"],
        "NORTH_POLE_FOREST_SEQUENCE_DONE",
        None,
        _forest_sequence,
    ),
    (
        "np-forest-signs",
        CHOOSE,
        "Read the forest signs",
        ["NORTH_POLE_FOREST_SEQUENCE_DONE"],
        "NORTH_POLE_FOREST_SIGNS_READ",
        None,
        _forest_signs,
    ),
    (
        "np-forest-stripes",
        ORDER,
        "Candy stripe pattern",
        ["NORTH_POLE_FOREST_SIGNS_READ"],
        "NORTH_POLE_FOREST_DONE",
        "np-rule-forest",
        _forest_stripes,
    ),
    (
        "np-lake-sums",
        CHOOSE,
        "Hop the ice floes",
        ["NORTH_POLE_FOREST_DONE"],
        "NORTH_POLE_LAKE_BRIDGE",
        None,
        _lake_sums,
    ),
    (
        "np-lake-order",
        ORDER,
        "Floes in number order",
        ["NORTH_POLE_LAKE_BRIDGE"],
        "NORTH_POLE_LAKE_ORDERED",
        None,
        _lake_order,
    ),
    (
        "np-lake-shapes",
        CHOOSE,
        "Shapes and parts on the lake",
        ["NORTH_POLE_LAKE_ORDERED"],
        "NORTH_POLE_LAKE_DONE",
        "np-rule-lake",
        _lake_shapes,
    ),
    (
        "np-stables-facts",
        CHOOSE,
        "Reindeer facts",
        ["NORTH_POLE_LAKE_DONE"],
        "NORTH_POLE_STABLES_FACTS_LEARNED",
        None,
        _stables_facts,
    ),
    (
        "np-stables-tracks",
        CHOOSE,
        "Follow the tracks",
        ["NORTH_POLE_STABLES_FACTS_LEARNED"],
        "NORTH_POLE_STABLES_TRACKS_FOLLOWED",
        None,
        _stables_tracks,
    ),
    (
        "np-stables-supplies",
        CHOOSE,
        "Supplies for the reindeer",
        ["NORTH_POLE_STABLES_TRACKS_FOLLOWED"],
        "NORTH_POLE_STABLES_SUPPLIES_FOUND",
        None,
        _stables_supplies,
    ),
    (
        "np-stables-return",
        PuzzleKind.RETURN_TO_NPC,
        "Bring Snowball home",
        ["NORTH_POLE_STABLES_SUPPLIES_FOUND", "NORTH_POLE_SNOWBALL_FOUND"],
        "NORTH_POLE_SNOWBALL_HOME",
        "np-rule-reindeer",
        _stables_return,
    ),
    (
        "np-ginger-shapes",
        CHOOSE,
        "Match the shapes",
        ["NORTH_POLE_SNOWBALL_HOME"],
        "NORTH_POLE_GINGER_SHAPES_MATCHED",
        None,
        _ginger_shapes,
    ),
    (
        "np-ginger-symmetry",
        CHOOSE,
        "Finish the window",
        ["NORTH_POLE_GINGER_SHAPES_MATCHED"],
        "NORTH_POLE_GINGER_SYMMETRY_DONE",
        None,
        _ginger_symmetry,
    ),
    (
        "np-ginger-recipe",
        CHOOSE,
        "Mrs. Claus's recipe",
        ["NORTH_POLE_GINGER_SYMMETRY_DONE"],
        "NORTH_POLE_GINGER_RECIPE_READ",
        None,
        _ginger_recipe,
    ),
    (
        "np-ginger-measure",
        CHOOSE,
        "Measure the gingerbread",
        ["NORTH_POLE_GINGER_RECIPE_READ"],
        "NORTH_POLE_GINGER_MEASURED",
        None,
        _ginger_measure,
    ),
    (
        "np-ginger-build",
        PuzzleKind.PLACE_PLATFORMS,
        "Repair the gingerbread wall",
        ["NORTH_POLE_GINGER_MEASURED"],
        "NORTH_POLE_GINGER_REPAIRED",
        "np-rule-gingerbread",
        _ginger_build,
    ),
    (
        "np-mountain-weather",
        CHOOSE,
        "Snow, ice and water",
        ["NORTH_POLE_MOUNTAIN_BRIDGE_TWO"],
        "NORTH_POLE_MOUNTAIN_SUMMIT",
        "np-rule-mountain",
        _mountain_weather,
    ),
    (
        "np-obs-stars",
        CHOOSE,
        "About stars",
        ["NORTH_POLE_MOUNTAIN_SUMMIT"],
        "NORTH_POLE_OBS_STARS_LEARNED",
        None,
        _obs_stars,
    ),
    (
        "np-obs-constellation",
        CHOOSE,
        "Find the constellation",
        ["NORTH_POLE_OBS_STARS_LEARNED"],
        "NORTH_POLE_OBS_CONSTELLATION_FOUND",
        None,
        _obs_constellation,
    ),
    (
        "np-obs-sequence",
        ORDER,
        "The night sky in order",
        ["NORTH_POLE_OBS_CONSTELLATION_FOUND"],
        "NORTH_POLE_OBS_SEQUENCE_DONE",
        None,
        _obs_sequence,
    ),
    (
        "np-obs-fragments",
        ORDER,
        "Set the star fragments",
        ["NORTH_POLE_OBS_SEQUENCE_DONE", *_FRAGMENT_KEYS],
        "NORTH_POLE_FRAGMENTS_PLACED",
        None,
        _obs_fragments,
    ),
    (
        "np-obs-final",
        CHOOSE,
        "The final star challenge",
        ["NORTH_POLE_FRAGMENTS_PLACED"],
        "NORTH_POLE_STAR_RESTORED",
        "np-rule-star",
        _obs_final,
    ),
    (
        "np-eve-sleigh-bell",
        PuzzleKind.COLLECT_OBJECT,
        "Ring the sleigh bell",
        ["NORTH_POLE_STAR_RESTORED"],
        "NORTH_POLE_CHRISTMAS_EVE",
        "np-rule-christmas-eve",
        _eve_bell,
    ),
]

# _quiz-built bands need their own factory reading ENTITY_MAPS (defined above), so the
# bodies are built last.
PUZZLES: list[dict] = []
for _pid, _kind, _title, _requires, _key, _reward, _factory in _TABLE:
    PUZZLES.append(
        {
            "puzzleId": _pid,
            "kind": _kind,
            "title": _title,
            "requiresChangeKeys": list(_requires),
            "worldChangeKey": _key,
            "rewardRuleId": _reward,
            "ageBands": {band: _factory(band) for band in BANDS},
        }
    )


SNAPSHOT_PATH = Path(__file__).with_name("north_pole_puzzles.json")


def snapshot() -> list[dict]:
    """The puzzle bodies as JSON, so the React tests parse the real content (no Python import)."""
    return json.loads(json.dumps(PUZZLES))


def write_snapshot() -> None:
    SNAPSHOT_PATH.write_text(json.dumps(snapshot(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()  # silent: application code does not print (test_privacy_logging)

"""The Heart of Firepeak's fourteen puzzles: bodies, per-band parameters and entity ids.

Authored content (ADR-047): the seed records each body as that puzzle's first published revision
(origin SEED); administrators edit it afterwards and re-seeding never overwrites it. Parameters
only. What Flint, Kindle, Professor Basalt, Cinder and Ignis say about a puzzle (`intro`,
`completeMessage`, `scienceNote`) is NPC dialogue in the content export, never a parameter here.

Design section 6 is the table: puzzle ids, change keys, requirements and reward rules are fixed.
Learning content follows the Pathfinder (5 to 6) and Explorer (7 to 8) column of that table.
Every option and item carries a symbol so answers never depend on colour alone, every prompt
reads aloud in one breath, and every explanation says why the answer is right in a supportive
voice. Real science is real (Professor Basalt's lines start from facts); magic is called magic.
"""

from __future__ import annotations

from .firepeak_heart_layout import K

SYMBOLS = ["circle", "square", "triangle", "star", "diamond", "hexagon", "heart", "moon"]
KIND_OBSERVE = "OBSERVE_FEATURES"
KIND_CHOOSE = "CHOOSE_ANSWER"
KIND_ORDER = "ORDER_SEQUENCE"
KIND_COLLECT = "COLLECT_OBJECT"
KIND_RETURN = "RETURN_TO_NPC"
BANDS = ("PATHFINDER", "EXPLORER")


def choose(vid, prompt, labels, answer, explanation, ids="abcd"):
    """A CHOOSE_ANSWER variant; `answer` is the correct label."""
    options = [
        {"id": ids[i], "label": label, "symbol": SYMBOLS[i]} for i, label in enumerate(labels)
    ]
    return {
        "id": vid,
        "prompt": prompt,
        "options": options,
        "answer": ids[labels.index(answer)],
        "explanation": explanation,
    }


def order(vid, prompt, labels, explanation, ids, shift=0):
    """An ORDER_SEQUENCE variant; `labels` are in the correct order, ids are dealt out rotated."""
    count = len(labels)
    dealt = [ids[(i + shift) % count] for i in range(count)]
    items = sorted(
        ({"id": dealt[i], "label": labels[i]} for i in range(count)),
        key=lambda item: ids.index(item["id"]),
    )
    for index, item in enumerate(items):
        item["symbol"] = SYMBOLS[index]
    return {
        "id": vid,
        "prompt": prompt,
        "items": items,
        "answer": dealt,
        "explanation": explanation,
    }


def _choose_params(presentation, subject, entities, variants, hints):
    return {
        "presentation": presentation,
        "subject": subject,
        "optionEntities": entities,
        "variants": variants,
        "hints": hints,
        "hintAfterAttempts": 2,
    }


def _order_params(presentation, subject, entities, variants, hints):
    return {
        "presentation": presentation,
        "subject": subject,
        "itemEntities": entities,
        "variants": variants,
        "hints": hints,
        "hintAfterAttempts": 2,
    }


def _entities(prefix, ids):
    return {i: f"{prefix}{i}" for i in ids}


# --- 1. the map (OBSERVE_FEATURES) -------------------------------------------------------------

MAP_PLACES = [
    (
        "forest",
        "Emberwood Forest",
        "A warm forest of tall trees. Kindle the fire spirit lives there.",
    ),
    ("lava", "Lava Crossing", "A river of glowing lava. A bridge can take you safely across."),
    (
        "caverns",
        "Crystal Caverns",
        "Caves where crystals glow. Real volcanoes can have crystals too.",
    ),
    ("forge", "Ancient Forge", "Old machines that Cinder looks after. They need waking up."),
    ("summit", "Firepeak Summit", "The high top of the mountain, with a wide view of the island."),
]


def _map(band):
    chosen = MAP_PLACES[:5] if band == "EXPLORER" else [MAP_PLACES[0], MAP_PLACES[1], MAP_PLACES[4]]
    return {
        "features": [{"id": i, "label": label, "explanation": text} for i, label, text in chosen],
        "hints": ["Touch each place on the map. Look for all of them."],
    }


# --- 2. the crystal pattern (CHOOSE_ANSWER, CRYSTALS) ------------------------------------------

PATTERN_ENTITIES = _entities("fh-ember-crystal-", "abc")


def _pattern(band):
    if band == "PATHFINDER":
        variants = [
            choose(
                "v1",
                "The crystals glow in a pattern: red, blue, red, blue, red. What comes next?",
                ["Blue", "Red", "Green"],
                "Blue",
                "The pattern is red, blue, red, blue. After red comes blue.",
                "abc",
            ),
            choose(
                "v2",
                "The crystals go: tall, short, tall, short, tall. What comes next?",
                ["Tall", "Short", "Wide"],
                "Short",
                "Tall and short take turns. After tall comes short.",
                "abc",
            ),
            choose(
                "v3",
                "The crystals go: red, blue, green, red, blue. What comes next?",
                ["Blue", "Red", "Green"],
                "Green",
                "The pattern repeats red, blue, green. After blue comes green.",
                "abc",
            ),
            choose(
                "v4",
                "The crystals go: star, moon, sun, star, moon. What comes next?",
                ["Star", "Sun", "Moon"],
                "Sun",
                "Star, moon, sun makes one round. Then it starts again, so sun is next.",
                "abc",
            ),
        ]
        hints = [
            "Say the pattern out loud. Which part repeats?",
            "Find where the pattern starts again.",
        ]
    else:
        variants = [
            choose(
                "v1",
                "The crystals show 2, 4, 6, 8. What number comes next?",
                ["9", "10", "12"],
                "10",
                "Each number is 2 more than the one before. 8 and 2 more is 10.",
                "abc",
            ),
            choose(
                "v2",
                "The crystals show 5, 10, 15, 20. What number comes next?",
                ["25", "30", "22"],
                "25",
                "Each number grows by 5. 20 and 5 more is 25.",
                "abc",
            ),
            choose(
                "v3",
                "The crystals show 1, 2, 4, 8. Each number is double the one before. What is next?",
                ["10", "16", "12"],
                "16",
                "Double 8 is 16. Doubling makes a growing pattern.",
                "abc",
            ),
            choose(
                "v4",
                "The crystal rows have 3, then 5, then 7 crystals. "
                "How many will the next row have?",
                ["8", "11", "9"],
                "9",
                "Each row has 2 more crystals than the last. 7 and 2 more is 9.",
                "abc",
            ),
            choose(
                "v5",
                "The crystals show 20, 18, 16, 14. What number comes next?",
                ["12", "13", "10"],
                "12",
                "Each number is 2 less than the one before. 14 take away 2 is 12.",
                "abc",
            ),
        ]
        hints = [
            "How much does the number change each time?",
            "Try counting on from the last crystal.",
        ]
    return _choose_params("CRYSTALS", "MATHEMATICS", PATTERN_ENTITIES, variants, hints)


# --- 3. count the embers (CHOOSE_ANSWER, CARDS) ------------------------------------------------

COUNT_ENTITIES = _entities("fh-count-card-", "abc")


def _count(band):
    if band == "PATHFINDER":
        variants = [
            choose(
                "v1",
                "The fire pit has 6 embers. The basket has 9 embers. Which has more?",
                ["Fire pit", "Basket", "Same"],
                "Basket",
                "9 is more than 6, so the basket has more embers.",
                "abc",
            ),
            choose(
                "v2",
                "Which group has fewer: 7 embers or 4 embers?",
                ["7 embers", "4 embers", "Same"],
                "4 embers",
                "4 is fewer than 7. Fewer means not as many.",
                "abc",
            ),
            choose(
                "v3",
                "Count on with Kindle: 2, 3, 4, 5. What number comes next?",
                ["5", "7", "6"],
                "6",
                "Counting goes one at a time. After 5 comes 6.",
                "abc",
            ),
            choose(
                "v4",
                "Kindle has 5 embers. Flint gives 2 more. How many embers are there now?",
                ["6", "7", "8"],
                "7",
                "Start at 5 and count on 2 more: 6, 7. There are 7 embers.",
                "abc",
            ),
        ]
        hints = ["Touch each ember as you count.", "Count slowly, one at a time."]
    else:
        variants = [
            choose(
                "v1",
                "Count by 5s: 5, 10, 15. What number comes next?",
                ["18", "20", "25"],
                "20",
                "Skip counting by 5 adds 5 each time. 15 and 5 more is 20.",
                "abc",
            ),
            choose(
                "v2",
                "There are 3 baskets with 4 embers in each. How many embers are there in all?",
                ["7", "12", "16"],
                "12",
                "3 groups of 4 is 4 + 4 + 4, which is 12.",
                "abc",
            ),
            choose(
                "v3",
                "Count by 2s: 10, 12, 14. What number comes next?",
                ["15", "18", "16"],
                "16",
                "Skip counting by 2 adds 2 each time. 14 and 2 more is 16.",
                "abc",
            ),
            choose(
                "v4",
                "There are 4 nests with 5 embers in each. How many embers are there in all?",
                ["9", "25", "20"],
                "20",
                "4 groups of 5 is 5 + 5 + 5 + 5, which is 20.",
                "abc",
            ),
        ]
        hints = ["Count in groups instead of one by one.", "Add the same number again and again."]
    return _choose_params("CARDS", "MATHEMATICS", COUNT_ENTITIES, variants, hints)


# --- 4. numbers on the stepping stones (CHOOSE_ANSWER, PLATFORMS) ------------------------------

LAVA_ENTITIES = _entities("fh-lava-stone-", "abc")


def _lava_numbers(band):
    if band == "PATHFINDER":
        variants = [
            choose(
                "v1",
                "The bridge stone needs the answer to 3 + 4. Which stone is right?",
                ["5", "7", "9"],
                "7",
                "3 and 4 more is 7. Count on from 3: 4, 5, 6, 7.",
                "abc",
            ),
            choose(
                "v2",
                "Which stone has the answer to 9 - 4?",
                ["4", "6", "5"],
                "5",
                "Start at 9 and take away 4. That leaves 5.",
                "abc",
            ),
            choose(
                "v3",
                "Which stone has the answer to 6 + 2?",
                ["9", "8", "7"],
                "8",
                "6 and 2 more is 8.",
                "abc",
            ),
            choose(
                "v4",
                "Which stone has the answer to 10 - 3?",
                ["7", "6", "8"],
                "7",
                "10 take away 3 is 7.",
                "abc",
            ),
        ]
        hints = ["Use your fingers to count on or back.", "Draw the numbers as dots if it helps."]
    else:
        variants = [
            choose(
                "v1",
                "Which stone has the answer to 34 + 25?",
                ["49", "59", "69"],
                "59",
                "30 + 20 is 50, and 4 + 5 is 9. Together that is 59.",
                "abc",
            ),
            choose(
                "v2",
                "Which stone has the answer to 72 - 18?",
                ["54", "64", "56"],
                "54",
                "Take away 20 to get 52, then add 2 back. The answer is 54.",
                "abc",
            ),
            choose(
                "v3",
                "Which stone has the answer to 6 times 7?",
                ["36", "42", "48"],
                "42",
                "6 groups of 7 make 42. 6 times 7 is 42.",
                "abc",
            ),
            choose(
                "v4",
                "Which stone has the answer to 45 + 38?",
                ["73", "93", "83"],
                "83",
                "40 + 30 is 70, and 5 + 8 is 13. 70 + 13 is 83.",
                "abc",
            ),
            choose(
                "v5",
                "Which stone has the answer to 8 times 5?",
                ["35", "45", "40"],
                "40",
                "8 groups of 5 make 40. Counting by 5s, eight times, lands on 40.",
                "abc",
            ),
        ]
        hints = [
            "Break the numbers into tens and ones.",
            "Check your answer by doing it another way.",
        ]
    return _choose_params("PLATFORMS", "MATHEMATICS", LAVA_ENTITIES, variants, hints)


# --- 5. choose the path (CHOOSE_ANSWER, PATHS) -------------------------------------------------

COMPARE_ENTITIES = _entities("fh-lava-path-", "abc")


def _lava_compare(band):
    if band == "PATHFINDER":
        variants = [
            choose(
                "v1",
                "Take the path with the biggest number. Which path is it?",
                ["12", "17", "9"],
                "17",
                "17 is bigger than 12 and 9. It has the most.",
                "abc",
            ),
            choose(
                "v2",
                "Take the path with the smallest number. Which path is it?",
                ["15", "19", "8"],
                "8",
                "8 is smaller than 15 and 19. It has the least.",
                "abc",
            ),
            choose(
                "v3",
                "Which path has the number that is more than 15?",
                ["11", "18", "14"],
                "18",
                "18 is more than 15. The other two are less.",
                "abc",
            ),
            choose(
                "v4",
                "Which path has the number that is less than 10?",
                ["13", "6", "16"],
                "6",
                "6 is less than 10. The other two are more.",
                "abc",
            ),
        ]
        hints = [
            "Count up from zero. The number you say later is bigger.",
            "Find the biggest tens digit first.",
        ]
    else:
        variants = [
            choose(
                "v1",
                "Which path shows the greatest number?",
                ["67", "76", "58"],
                "76",
                "76 has 7 tens. 67 has only 6 tens and 58 has 5 tens.",
                "abc",
            ),
            choose(
                "v2",
                "Which path shows the smallest number?",
                ["91", "49", "19"],
                "19",
                "19 has just 1 ten. That is fewer tens than the others.",
                "abc",
            ),
            choose(
                "v3",
                "Which path shows half of 20?",
                ["5", "10", "40"],
                "10",
                "Half means 2 equal parts. 10 and 10 make 20.",
                "abc",
            ),
            choose(
                "v4",
                "Which path shows half of 18?",
                ["6", "36", "9"],
                "9",
                "Half of 18 is 9, because 9 + 9 is 18.",
                "abc",
            ),
            choose(
                "v5",
                "The path number must be more than 45 and less than 60. Which one fits?",
                ["40", "52", "65"],
                "52",
                "52 is more than 45 and less than 60. The others are outside.",
                "abc",
            ),
        ]
        hints = ["Compare the tens first, then the ones.", "Say each number out loud in order."]
    return _choose_params("PATHS", "MATHEMATICS", COMPARE_ENTITIES, variants, hints)


# --- 6. shapes in the caverns (CHOOSE_ANSWER, SHAPES; four options) ----------------------------

SHAPE_ENTITIES = _entities("fh-cavern-shape-", "abcd")


def _shapes(band):
    if band == "PATHFINDER":
        names = ["Circle", "Triangle", "Square", "Hexagon"]
        variants = [
            choose(
                "v1",
                "Touch the shape that has 3 sides.",
                names,
                "Triangle",
                "A triangle has 3 sides and 3 corners.",
                "abcd",
            ),
            choose(
                "v2",
                "Touch the shape that is round and has no corners.",
                names,
                "Circle",
                "A circle is round. It has no straight sides and no corners.",
                "abcd",
            ),
            choose(
                "v3",
                "Touch the shape that has 4 sides that are all the same length.",
                names,
                "Square",
                "A square has 4 equal sides and 4 corners.",
                "abcd",
            ),
            choose(
                "v4",
                "Touch the shape that has 6 sides.",
                names,
                "Hexagon",
                "A hexagon has 6 sides. Bees make hexagons in their honeycomb.",
                "abcd",
            ),
        ]
        hints = ["Count the straight sides with your finger.", "Count the corners too."]
        subject = "MATHEMATICS"
    else:
        variants = [
            choose(
                "v1",
                "How many faces does a cube have?",
                ["4", "6", "8", "12"],
                "6",
                "A cube has 6 flat faces: top, bottom and 4 sides.",
                "abcd",
            ),
            choose(
                "v2",
                "How many corners does a square have?",
                ["3", "5", "4", "6"],
                "4",
                "A square has 4 corners and 4 sides.",
                "abcd",
            ),
            choose(
                "v3",
                "A square is cut into quarters. How many equal parts are there?",
                ["2", "3", "4", "8"],
                "4",
                "Quarters are 4 equal parts. Each part is one quarter.",
                "abcd",
            ),
            choose(
                "v4",
                "How many edges does a cube have?",
                ["6", "8", "10", "12"],
                "12",
                "A cube has 12 edges: 4 on the top, 4 on the bottom and 4 standing up.",
                "abcd",
            ),
            choose(
                "v5",
                "How many sides does a pentagon have?",
                ["4", "5", "6", "8"],
                "5",
                "A pentagon has 5 sides and 5 corners.",
                "abcd",
            ),
        ]
        hints = [
            "Picture the shape and count one part at a time.",
            "Faces are flat sides. Edges are where they meet.",
        ]
        subject = "MATHEMATICS"
    return _choose_params("SHAPES", subject, SHAPE_ENTITIES, variants, hints)


# --- 7. arrange the cave crystals (ORDER_SEQUENCE, CRYSTALS; four items) -----------------------

ARRANGE_ENTITIES = _entities("fh-cavern-crystal-", "abcd")


def _arrange(band):
    if band == "PATHFINDER":
        variants = [
            order(
                "v1",
                "Put the crystals in order from smallest to largest.",
                ["Tiny crystal", "Small crystal", "Big crystal", "Huge crystal"],
                "The smallest goes first and the biggest goes last.",
                "abcd",
                0,
            ),
            order(
                "v2",
                "Put the crystals in order from the smallest number to the biggest number.",
                ["2", "4", "7", "9"],
                "2 is the smallest. Then 4, then 7, then 9.",
                "abcd",
                2,
            ),
            order(
                "v3",
                "Put the crystals in order from biggest to smallest.",
                ["Huge crystal", "Big crystal", "Small crystal", "Tiny crystal"],
                "The biggest goes first and the tiniest goes last.",
                "abcd",
                1,
            ),
            order(
                "v4",
                "Put the crystal numbers in order, smallest first.",
                ["3", "8", "12", "15"],
                "3 is smallest, then 8, then 12, then 15.",
                "abcd",
                3,
            ),
        ]
        hints = ["Find the smallest first.", "Then find the next smallest."]
    else:
        variants = [
            order(
                "v1",
                "Put the crystals in order by their number of sides, fewest first.",
                ["Triangle", "Square", "Pentagon", "Hexagon"],
                "A triangle has 3 sides, a square 4, a pentagon 5 and a hexagon 6.",
                "abcd",
                0,
            ),
            order(
                "v2",
                "Put the fractions in order from smallest to largest.",
                ["1/8", "1/4", "1/3", "1/2"],
                "The more parts a whole is cut into, the smaller each part is. 1/8 is smallest, "
                "1/2 is largest.",
                "abcd",
                1,
            ),
            order(
                "v3",
                "Put the fractions in order from smallest to largest.",
                ["1/8", "1/4", "1/2", "3/4"],
                "1/8 is a small slice. 3/4 is three quarters of the whole, the biggest here.",
                "abcd",
                2,
            ),
            order(
                "v4",
                "Put the numbers in order from smallest to largest.",
                ["14", "41", "48", "84"],
                "Compare the tens first. 14 is smallest and 84 is biggest.",
                "abcd",
                3,
            ),
        ]
        hints = ["Compare two crystals at a time.", "Think about how big each part is."]
    return _order_params("CRYSTALS", "MATHEMATICS", ARRANGE_ENTITIES, variants, hints)


# --- 8. wake the forge machines (ORDER_SEQUENCE, SWITCHES) -------------------------------------

SWITCH_IDS_P = ["red", "blue", "gold"]
SWITCH_IDS_E = ["red", "blue", "gold", "green"]
SWITCH_ENTITIES_P = {i: f"fh-forge-switch-{i}" for i in SWITCH_IDS_P}
SWITCH_ENTITIES_E = {i: f"fh-forge-switch-{i}" for i in SWITCH_IDS_E}


def _switches(band):
    if band == "PATHFINDER":
        ids = SWITCH_IDS_P
        variants = [
            order(
                "v1",
                "The water turns the wheel. The wheel turns the gears. The gears light the lamp. "
                "Press the switches in that order.",
                ["Water switch", "Wheel switch", "Lamp switch"],
                "The water pushes the wheel first, then the wheel moves the gears, and last the "
                "lamp lights.",
                ids,
                0,
            ),
            order(
                "v2",
                "To heat the forge, put in coal, then light the fire, then pump the bellows.",
                ["Add coal", "Light the fire", "Pump the bellows"],
                "The fire needs coal first. Once it is lit, air from the bellows makes it hotter.",
                ids,
                1,
            ),
            order(
                "v3",
                "To lower the bridge, pull the lever. The chain moves. Then the bridge comes down.",
                ["Pull the lever", "Chain moves", "Bridge lowers"],
                "One thing causes the next: the lever moves the chain, and the chain lowers the "
                "bridge.",
                ids,
                2,
            ),
            order(
                "v4",
                "To make a metal tool, heat the metal, then hammer it, then dip it in water.",
                ["Heat the metal", "Hammer it", "Dip it in water"],
                "Hot metal is soft, so it is hammered into shape. Water cools it at the end.",
                ids,
                0,
            ),
        ]
        entities = SWITCH_ENTITIES_P
        hints = ["What has to happen first?", "Each step makes the next one happen."]
    else:
        ids = SWITCH_IDS_E
        variants = [
            order(
                "v1",
                "The pump starts first. The water must cool before the gears turn. The lamp lights "
                "last.",
                ["Pump starts", "Water cools", "Gears turn", "Lamp lights"],
                "Cool water must come before the gears turn, and the lamp is the very last step.",
                ids,
                0,
            ),
            order(
                "v2",
                "Add coal first. The fire needs air before it gets hot. The metal melts last of "
                "all.",
                ["Add coal", "Pump air", "Fire gets hot", "Metal melts"],
                "Air comes before heat, because a fire needs air to burn hotter. Melting comes "
                "last.",
                ids,
                1,
            ),
            order(
                "v3",
                "Switch the power on first. The brake must be released before the lift moves. The "
                "lift stops at the top last.",
                ["Power on", "Release the brake", "Lift moves up", "Lift stops at the top"],
                "The brake must be off before the lift can move, "
                "so it comes right after the power.",
                ids,
                2,
            ),
            order(
                "v4",
                "Boil the water first. The valve opens only after steam builds. The whistle sounds "
                "last.",
                ["Boil the water", "Steam builds", "Valve opens", "Whistle sounds"],
                "Boiling makes steam, and steam pushes through the open valve to make the whistle "
                "sound.",
                ids,
                3,
            ),
        ]
        entities = SWITCH_ENTITIES_E
        hints = [
            "Find the step that has to be first or last.",
            "Look for words like before and after.",
        ]
    return _order_params("SWITCHES", "LOGIC", entities, variants, hints)


# --- 9. the forge circuit (CHOOSE_ANSWER, PATHS) -----------------------------------------------

CIRCUIT_ENTITIES = _entities("fh-circuit-path-", "abc")


def _circuit(band):
    if band == "PATHFINDER":
        variants = [
            choose(
                "v1",
                "A lamp lights when the wire makes a full loop. Path A has a gap in the wire. Path "
                "B is a full loop. Path C stops before the lamp. Which path lights the lamp?",
                ["Path A", "Path B", "Path C"],
                "Path B",
                "Only a full loop with no gap lets the power reach the lamp.",
                "abc",
            ),
            choose(
                "v2",
                "Path A is a full loop to the lamp. Path B has a cut wire. Path C has no battery. "
                "Which path lights the lamp?",
                ["Path A", "Path B", "Path C"],
                "Path A",
                "A full loop with a battery lights the lamp. A cut wire or no battery cannot.",
                "abc",
            ),
            choose(
                "v3",
                "Path A has a gap. Path B has no lamp. Path C is a full loop with a battery and a "
                "lamp. Which path lights the lamp?",
                ["Path A", "Path B", "Path C"],
                "Path C",
                "Path C has everything a lamp needs: a battery, a lamp and a full loop.",
                "abc",
            ),
            choose(
                "v4",
                "Path A has a switch that is open, so there is a gap. Path B has a switch that is "
                "closed. Path C has no wire. Which path lights the lamp?",
                ["Path A", "Path B", "Path C"],
                "Path B",
                "A closed switch closes the loop, so the power can flow to the lamp.",
                "abc",
            ),
        ]
        hints = ["Follow the wire with your finger. Does it make a loop?", "A gap stops the power."]
        subject = "LOGIC"
    else:
        variants = [
            choose(
                "v1",
                "A circuit needs a battery, a lamp and a closed loop. Path A has a gap. Path B has "
                "no battery. Path C has all three. Which path lights the lamp?",
                ["Path A", "Path B", "Path C"],
                "Path C",
                "Only Path C has a battery, a lamp and a closed loop.",
                "abc",
            ),
            choose(
                "v2",
                "The forge has 12 crystals to share equally between 3 lamps. How many crystals "
                "does each lamp get?",
                ["3", "6", "4"],
                "4",
                "12 shared equally into 3 groups is 4 each, because 4 + 4 + 4 is 12.",
                "abc",
            ),
            choose(
                "v3",
                "The forge has 15 crystals to share equally among 5 lamps. How many does each lamp "
                "get?",
                ["2", "5", "3"],
                "3",
                "15 shared equally into 5 groups is 3 each, because 5 times 3 is 15.",
                "abc",
            ),
            choose(
                "v4",
                "The forge has 20 crystals to share equally between 4 lamps. How many does each "
                "lamp get?",
                ["4", "10", "5"],
                "5",
                "20 shared equally into 4 groups is 5 each, because 4 times 5 is 20.",
                "abc",
            ),
            choose(
                "v5",
                "A switch is open in Path A and closed in Path B. Path C has no lamp. Which path "
                "can light the lamp?",
                ["Path A", "Path B", "Path C"],
                "Path B",
                "The closed switch makes the loop complete. The open switch leaves a gap.",
                "abc",
            ),
        ]
        hints = [
            "For sharing, make equal groups.",
            "Check that the loop is closed all the way round.",
        ]
        subject = "LOGIC"
    return _choose_params("PATHS", subject, CIRCUIT_ENTITIES, variants, hints)


# --- 10. name the rocks (CHOOSE_ANSWER, SAMPLES) -----------------------------------------------

ROCK_ENTITIES = _entities("fh-rock-sample-", "abc")


def _rocks(band):
    if band == "PATHFINDER":
        variants = [
            choose(
                "v1",
                "Melted rock deep under the ground has a name. What is it?",
                ["Magma", "Sand", "Lava"],
                "Magma",
                "Melted rock under the ground is called magma.",
                "abc",
            ),
            choose(
                "v2",
                "Melted rock that flows out of a volcano has a name. What is it?",
                ["Magma", "Lava", "Ice"],
                "Lava",
                "When magma comes out of a volcano, we call it lava.",
                "abc",
            ),
            choose(
                "v3",
                "Lava cools down for a long time. What does it turn into?",
                ["Water", "Hard rock", "Sand"],
                "Hard rock",
                "Cooling lava becomes hard, new rock.",
                "abc",
            ),
            choose(
                "v4",
                "Where can you find magma?",
                ["In the clouds", "Under the ground", "In the sea"],
                "Under the ground",
                "Magma is hot melted rock found deep under the ground.",
                "abc",
            ),
        ]
        hints = ["Think about where the melted rock is.", "Hot rock gets hard when it cools."]
    else:
        variants = [
            choose(
                "v1",
                "Which rock is dark and forms when runny lava cools?",
                ["Basalt", "Chalk", "Sandstone"],
                "Basalt",
                "Basalt is a dark volcanic rock made when lava cools and hardens.",
                "abc",
            ),
            choose(
                "v2",
                "Which volcanic rock has so many air bubbles that it can float on water?",
                ["Obsidian", "Pumice", "Basalt"],
                "Pumice",
                "Pumice is full of tiny gas bubbles, so it is light enough to float.",
                "abc",
            ),
            choose(
                "v3",
                "Which shiny, glassy rock forms when lava cools very quickly?",
                ["Pumice", "Chalk", "Obsidian"],
                "Obsidian",
                "Obsidian is volcanic glass. It forms when lava cools too fast to make crystals.",
                "abc",
            ),
            choose(
                "v4",
                "A volcano is sleeping but could erupt again one day. What do scientists call it?",
                ["Active", "Dormant", "Frozen"],
                "Dormant",
                "A dormant volcano has not erupted for a long time but may wake up again.",
                "abc",
            ),
            choose(
                "v5",
                "Igneous rocks form when what cools and hardens?",
                ["Mud", "Sand", "Magma or lava"],
                "Magma or lava",
                "Igneous rock begins as hot melted rock, either magma or lava.",
                "abc",
            ),
        ]
        hints = ["Think about how each rock was made.", "Read each name and picture its look."]
    return _choose_params("SAMPLES", "EARTH_SCIENCE", ROCK_ENTITIES, variants, hints)


# --- 11. the island story (ORDER_SEQUENCE, STORY) ----------------------------------------------

ISLAND_IDS_P = ["a", "b", "c"]
ISLAND_IDS_E = ["a", "b", "c", "d", "e"]


def _island(band):
    if band == "PATHFINDER":
        ids = ISLAND_IDS_P
        variants = [
            order(
                "v1",
                "Tell how a volcano makes rock. Put the steps in order.",
                ["Magma rises up", "The volcano erupts", "Lava cools into rock"],
                "Magma rises, it comes out as lava, and then the lava cools into new rock.",
                ids,
                0,
            ),
            order(
                "v2",
                "Tell how an island grows from the sea.",
                ["Lava flows into the sea", "Hardened lava piles up", "A new island appears"],
                "Lava cools in the sea and hardens. Layer after layer piles up until it rises "
                "above the water.",
                ids,
                1,
            ),
            order(
                "v3",
                "Tell the story of one rock.",
                ["Hot melted rock", "It flows out as lava", "It cools and hardens"],
                "It starts as melted rock, flows out, and becomes hard rock when it cools.",
                ids,
                2,
            ),
        ]
        entities = {i: f"fh-island-step-{i}" for i in ids}
        hints = ["What happens first, deep down?", "What happens last?"]
    else:
        ids = ISLAND_IDS_E
        variants = [
            order(
                "v1",
                "Put the steps in order to show how a volcano island forms.",
                ["Magma rises", "Volcano erupts", "Lava cools", "Layers build up", "Island forms"],
                "Magma rises and erupts, lava cools into rock, layers build up over many "
                "eruptions, and an island forms.",
                ids,
                0,
            ),
            order(
                "v2",
                "Put the steps in order, from deep underground to a new island.",
                [
                    "Magma collects deep underground",
                    "Pressure pushes magma up",
                    "Lava erupts and flows",
                    "Lava hardens into new rock",
                    "Many layers make a volcano island",
                ],
                "Real volcano islands grow slowly, one eruption and one layer at a time.",
                ids,
                2,
            ),
            order(
                "v3",
                "An eruption begins under the sea. Put the steps in order.",
                [
                    "An eruption begins underwater",
                    "Lava meets cold seawater",
                    "Lava cools fast into rock",
                    "Rock piles up higher each eruption",
                    "The top reaches above the waves",
                ],
                "Cold seawater cools the lava fast. Over many eruptions the rock builds up until "
                "it breaks the surface.",
                ids,
                4,
            ),
        ]
        entities = {i: f"fh-island-step-{i}" for i in ids}
        hints = [
            "Which step has to happen before the others?",
            "Island building takes many eruptions.",
        ]
    return _order_params("STORY", "EARTH_SCIENCE", entities, variants, hints)


# --- 12. the four elemental crystals (ORDER_SEQUENCE, CRYSTALS) --------------------------------

HEART_IDS = ["forest", "magma", "cavern", "forge"]
HEART_ENTITIES = {i: f"fh-heart-crystal-{i}" for i in HEART_IDS}


def _crystals(band):
    ids = HEART_IDS
    if band == "PATHFINDER":
        variants = [
            order(
                "v1",
                "Set the crystals in the order of your journey.",
                ["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
                "You found the forest crystal first, then magma, then cavern, then forge.",
                ids,
                0,
            ),
            order(
                "v2",
                "Which crystal did you find first? Start there and go in order.",
                ["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
                "Your journey went from the trees to the lava, then the caves, then the forge.",
                ids,
                0,
            ),
            order(
                "v3",
                "Remember the trip: trees, lava, caves, machines. Set the crystals in that order.",
                ["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
                "Trees came first, so the forest crystal starts. Machines came last, so the forge "
                "crystal ends.",
                ids,
                0,
            ),
        ]
        hints = ["Where did your journey begin?", "Think about each place you visited."]
    else:
        variants = [
            order(
                "v1",
                "Read the clue: first came the green trees, then the river of fire, then the "
                "glowing caves, then the old machines. Set the crystals in that order.",
                ["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
                "The clue lists the places in order, and each place gave you one crystal.",
                ids,
                0,
            ),
            order(
                "v2",
                "Read the clue: the forge crystal came after the cavern crystal. The forest "
                "crystal came before the magma crystal. The magma crystal came before the cavern "
                "crystal. Set them in order.",
                ["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
                "Forest is before magma, magma is before cavern, and cavern is before forge.",
                ids,
                0,
            ),
            order(
                "v3",
                "Read the clue: you crossed lava after the forest and before the caves. The forge "
                "was your last stop. Set the crystals in order.",
                ["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
                "Forest, then lava, then caves, then the forge: that is the order of the journey.",
                ids,
                0,
            ),
        ]
        hints = [
            "Read the clue again, one part at a time.",
            "Find the crystal that must come first.",
        ]
    return _order_params("CRYSTALS", "LITERACY", HEART_ENTITIES, variants, hints)


# --- 13 and 14 ---------------------------------------------------------------------------------


def _restore(band):
    return {"discoveryMessage": "The Heart of Firepeak glows warm and bright again!"}


def _return(band):
    return {"npcEntityId": "fh-ignis"}


# --- the table (design section 6) --------------------------------------------------------------

# puzzle id, kind, title, requires key, world change key, reward rule, factory, entity ids
PUZZLES = [
    (
        "fh-landing-map",
        KIND_OBSERVE,
        "Read the explorer's map",
        [],
        K["map"],
        "fh-rule-first-steps",
        _map,
        ["fh-map-sign"],
    ),
    (
        "fh-emberwood-pattern",
        KIND_CHOOSE,
        "Finish the crystal pattern",
        [K["map"]],
        K["pattern"],
        None,
        _pattern,
        list(PATTERN_ENTITIES.values()),
    ),
    (
        "fh-emberwood-count",
        KIND_CHOOSE,
        "Count the embers",
        [K["pattern"]],
        K["emberwood"],
        "fh-rule-emberwood",
        _count,
        list(COUNT_ENTITIES.values()),
    ),
    (
        "fh-lava-numbers",
        KIND_CHOOSE,
        "Build the lava bridge",
        [K["emberwood"]],
        K["bridge"],
        None,
        _lava_numbers,
        list(LAVA_ENTITIES.values()),
    ),
    (
        "fh-lava-compare",
        KIND_CHOOSE,
        "Choose the right path",
        [K["bridge"]],
        K["crossed"],
        "fh-rule-lava",
        _lava_compare,
        list(COMPARE_ENTITIES.values()),
    ),
    (
        "fh-caverns-shapes",
        KIND_CHOOSE,
        "Match the cave shapes",
        [K["crossed"]],
        K["shapes"],
        None,
        _shapes,
        list(SHAPE_ENTITIES.values()),
    ),
    (
        "fh-caverns-arrange",
        KIND_ORDER,
        "Arrange the cave crystals",
        [K["shapes"]],
        K["lit"],
        "fh-rule-caverns",
        _arrange,
        list(ARRANGE_ENTITIES.values()),
    ),
    (
        "fh-forge-switches",
        KIND_ORDER,
        "Wake the forge machines",
        [K["lit"]],
        K["powered"],
        None,
        _switches,
        [f"fh-forge-switch-{i}" for i in SWITCH_IDS_E],
    ),
    (
        "fh-forge-circuit",
        KIND_CHOOSE,
        "Light the forge lamp",
        [K["powered"]],
        K["restored_forge"],
        "fh-rule-forge",
        _circuit,
        list(CIRCUIT_ENTITIES.values()),
    ),
    (
        "fh-summit-rocks",
        KIND_CHOOSE,
        "Name the rocks",
        [K["restored_forge"]],
        K["rocks"],
        None,
        _rocks,
        list(ROCK_ENTITIES.values()),
    ),
    (
        "fh-summit-island",
        KIND_ORDER,
        "Tell the story of the island",
        [K["rocks"]],
        K["summit"],
        "fh-rule-scientist",
        _island,
        [f"fh-island-step-{i}" for i in ISLAND_IDS_E],
    ),
    (
        "fh-heart-crystals",
        KIND_ORDER,
        "Set the elemental crystals",
        [K["summit"]],
        K["crystals"],
        None,
        _crystals,
        list(HEART_ENTITIES.values()),
    ),
    (
        "fh-heart-restore",
        KIND_COLLECT,
        "Wake the Heart of Firepeak",
        [K["crystals"]],
        K["restored"],
        None,
        _restore,
        ["fh-heart-crystal"],
    ),
    (
        "fh-heart-return",
        KIND_RETURN,
        "Tell Ignis the good news",
        [K["restored"]],
        K["celebrated"],
        "fh-rule-heart",
        _return,
        ["fh-ignis"],
    ),
]


# --- curriculum skills (FPV-D10) -----------------------------------------------------------------

#: Each band's learning objective, and the variants that practise a different one. Codes are
#: catalog `LearningObjective` codes (`learningObjectives.ts`); `puzzle_skill_report --strict`
#: checks them. One row per band of docs/firepeak/CURRICULUM_AUDIT.md, which gives the reasons.
SKILLS = {
    "fh-emberwood-pattern": {
        "PATHFINDER": ("patterns", {}),
        "EXPLORER": ("patterns", {}),
    },
    "fh-emberwood-count": {
        "PATHFINDER": (
            "comparing-and-ordering-numbers",
            {"v3": "patterns", "v4": "addition-within-ten"},
        ),
        "EXPLORER": ("multiplication-facts", {"v1": "patterns", "v3": "patterns"}),
    },
    "fh-lava-numbers": {
        "PATHFINDER": (
            "addition-within-ten",
            {"v2": "subtraction-within-ten", "v4": "subtraction-within-ten"},
        ),
        "EXPLORER": (
            "addition-within-100",
            {
                "v2": "subtraction-within-100",
                "v3": "multiplication-facts",
                "v5": "multiplication-facts",
            },
        ),
    },
    "fh-lava-compare": {
        "PATHFINDER": ("comparing-and-ordering-numbers", {}),
        "EXPLORER": (
            "comparing-and-ordering-numbers",
            {"v3": "halves-and-fractions", "v4": "halves-and-fractions"},
        ),
    },
    "fh-caverns-shapes": {
        "PATHFINDER": ("shapes-and-geometry", {}),
        "EXPLORER": ("shapes-and-geometry", {"v3": "halves-and-fractions"}),
    },
    "fh-caverns-arrange": {
        "PATHFINDER": (
            "measurement",
            {"v2": "comparing-and-ordering-numbers", "v4": "comparing-and-ordering-numbers"},
        ),
        "EXPLORER": (
            "halves-and-fractions",
            {"v1": "shapes-and-geometry", "v4": "comparing-and-ordering-numbers"},
        ),
    },
    "fh-forge-switches": {
        "PATHFINDER": ("following-instructions", {}),
        "EXPLORER": ("cause-and-effect", {}),
    },
    "fh-forge-circuit": {
        "PATHFINDER": ("simple-circuits", {}),
        "EXPLORER": (
            "simple-circuits",
            {"v2": "equal-sharing", "v3": "equal-sharing", "v4": "equal-sharing"},
        ),
    },
    "fh-summit-rocks": {
        "PATHFINDER": ("earth-science", {}),
        "EXPLORER": ("earth-science", {}),
    },
    "fh-summit-island": {
        "PATHFINDER": ("earth-science", {}),
        "EXPLORER": ("earth-science", {}),
    },
    "fh-heart-crystals": {
        "PATHFINDER": ("sequencing", {}),
        "EXPLORER": ("reading-comprehension", {}),
    },
}


def _with_skills(puzzle_id, band, params):
    """Set the band's `skill` and each overriding variant's `skill` from `SKILLS`."""
    if puzzle_id not in SKILLS:
        return params
    default, overrides = SKILLS[puzzle_id][band]
    variant_ids = {v["id"] for v in params["variants"]}
    unknown = set(overrides) - variant_ids
    if unknown:
        raise ValueError(f"{puzzle_id} {band}: no variants {sorted(unknown)}")
    variants = [
        {**v, "skill": overrides[v["id"]]} if v["id"] in overrides else v
        for v in params["variants"]
    ]
    return {**params, "skill": default, "variants": variants}


def body(puzzle_id, kind, title, requires, change, reward, factory) -> dict:
    return {
        "puzzleId": puzzle_id,
        "kind": kind,
        "title": title,
        "requiresChangeKeys": list(requires),
        "worldChangeKey": change,
        "rewardRuleId": reward,
        "ageBands": {band: _with_skills(puzzle_id, band, factory(band)) for band in BANDS},
    }


def puzzle_rows() -> list[tuple[str, str, list[str], dict]]:
    """(puzzle id, kind, entity ids, body) in section 6 order."""
    return [
        (pid, kind, entities, body(pid, kind, title, requires, change, reward, factory))
        for pid, kind, title, requires, change, reward, factory, entities in PUZZLES
    ]

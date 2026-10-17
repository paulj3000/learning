/**
 * Generic, reusable output-safety checks (docs/AI_AND_CHILD_SAFETY.md
 * "Structured response example" validation rules: "no URLs", "no requests
 * for personal information"). Heuristic and intentionally conservative —
 * a false positive just falls back to authored content, which is safe;
 * false negatives are the risk to minimize.
 */

const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co)\b/i;

const PERSONAL_INFO_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\b(your|my) (real )?(full )?name\b/i,
  /\bhome address\b/i,
  /\bphone number\b/i,
  /\bschool('?s)? name\b/i,
  /\bwhere (do|you) live\b/i,
  /\bsend (me |us )?a photo\b/i,
  /\bmeet (up|me) in person\b/i,
  /\bemail address\b/i,
];

export function containsUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

export function requestsPersonalInformation(text: string): boolean {
  return PERSONAL_INFO_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Output check for the AI Tutor Engine (docs/ROADMAP.md Phase 27): a
 * tutoring reply must not judge the child or invent curriculum. Deciding
 * what a child has learned belongs to the Mastery Engine
 * (`src/features/mastery/`), which computes it from recorded evidence, and
 * deciding what comes next belongs to the curriculum graph
 * (`src/features/curriculum/`) - a model that says "you have mastered
 * counting" or "next you need to learn multiplication" has taken over a
 * decision neither it nor the prompt is allowed to make
 * (docs/DATA_MODEL.md: "Do not label children with fixed ability
 * judgments").
 *
 * Same conservative posture as the checks above: a false positive replaces
 * one turn with an authored line, which is safe; a false negative puts an
 * unearned verdict about a five-year-old on screen, which is not.
 */
const LEARNING_JUDGMENT_PATTERNS: RegExp[] = [
  /\byou (have |'ve )?(now )?master(ed)?\b/i,
  /\byou (passed|failed)\b/i,
  /\byou('re| are) (now )?(a |an )?(expert|advanced|behind|ahead|struggling|proficient)\b/i,
  /\byou('re| are) (at |on )?(reading )?level\b/i,
  /\b(grade|level) \d/i,
  /\byou('re| are) (not )?ready (for|to move)\b/i,
  /\byou (need|have) to learn\b/i,
  /\byou (must|should) (first )?learn\b/i,
  /\bnext (lesson|level|grade|unit)\b/i,
  /\byou('re| are) better (at|than)\b/i,
  /\bhomework\b/i,
];

export function claimsLearningJudgment(text: string): boolean {
  return LEARNING_JUDGMENT_PATTERNS.some((pattern) => pattern.test(text));
}

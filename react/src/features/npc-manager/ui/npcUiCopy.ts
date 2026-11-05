/**
 * Default English copy for the NPC interaction UI (LAI-NPC-014). Every string reaches the
 * components through props, so a locale passes its own; these are only the defaults. Short,
 * calm, readable aloud, and free of em dashes.
 */
export interface NpcDialogueCopy {
  continue: string;
  close: string;
  /** Shown (and announced) while the next line is on its way. */
  busy: string;
  /** Shown when a request failed; never blames the child. */
  error: string;
  retry: string;
  /** Accessible name of the choice list. */
  choicesLabel: string;
}

export const NPC_DIALOGUE_COPY: NpcDialogueCopy = {
  continue: 'Continue',
  close: 'Close',
  busy: 'Just a moment...',
  error: 'Hmm, that did not work. Let us try again.',
  retry: 'Try again',
  choicesLabel: 'What will you say?',
};

/** "Talk to Pirate Pip": the prompt's label for a character's display name. */
export function talkToLabel(displayName: string): string {
  return `Talk to ${displayName}`;
}

/**
 * Small decorative icons for the NPC interaction UI (LAI-NPC-038). Icon plus text for
 * pre-readers (`docs/UX_AND_ACCESSIBILITY.md`, "Child mode"): the text next to each icon is the
 * accessible name, so every icon is hidden from assistive technology.
 */

/** A speech bubble, for the Talk prompt. */
export function NpcTalkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1.5em"
      height="1.5em"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8.6l-4.7 3.8A.75.75 0 0 1 5.5 20.2V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3.5 6.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
      />
    </svg>
  );
}

/** A speaker with sound waves, for "Hear it again". */
export function NpcReplayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3V9Z" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
      />
    </svg>
  );
}

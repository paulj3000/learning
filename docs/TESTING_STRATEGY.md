# Testing Strategy

## Unit tests

- adventure transition functions;
- validators for number, ordering, matching, and choice steps;
- hint-level selection;
- age-band adaptation;
- skill-evidence derivation;
- world-change reducers;
- runtime AI schema validation;
- redaction utilities.

## Component tests

- parent authentication states;
- child profile form and parent gate;
- island map keyboard and touch interactions;
- narration controls;
- adventure step renderers;
- companion loading, response, invalid-output, and fallback states;
- parent dashboard summaries.

## Backend tests

- owner isolation between parent accounts;
- administrator boundaries;
- child profile CRUD authorization;
- adventure start/action/complete invariants;
- prevention of direct progress or world-change forgery;
- AI route authorization;
- storage path restrictions.

## End-to-end tests

Critical paths:
1. Parent registers and confirms account.
2. Parent creates a child profile.
3. Child enters island mode.
4. Child completes Pirate Builder Bay adventure.
5. World change appears on map.
6. Parent sees accurate learning summary.
7. AI failure produces safe deterministic fallback.
8. Session limit produces a calm stopping point.
9. Parent deletes or deactivates a child profile.

## AI evaluation suite

Maintain fixed test cases by age band covering:
- output length;
- vocabulary complexity;
- personal-information requests;
- secrecy and dependency language;
- unsafe topics;
- prompt injection in child input;
- invalid action IDs;
- misleading educational content;
- excessive praise or shame;
- correct use of hint levels;
- graceful uncertainty.

AI snapshots should validate structure and safety properties, not exact prose.

## Quality commands

Claude should establish and keep commands equivalent to:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```


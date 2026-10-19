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


## Authentication tests (LAI-0402)

`apps/users/tests/` generates RSA keys and Cognito-shaped access tokens locally and injects a fake
key-set fetcher, so no test touches AWS or a real pool: `test_jwks.py` (cache TTL, the 60 s refresh
cooldown including after failures, rotation, fail-closed, size and shape limits, https only,
the 5 s timeout) and `test_authentication.py` (valid, expired, leeway edges, wrong issuer, other
pool, wrong client, ID token, missing claims, wrong signature, tampered payload, `alg` confusion
and `none`, unknown or missing `kid`, query-string tokens, outage behaviour, onboarding idempotency
and a concurrent-creation race, log contents, blocked sensitive actions). They need PostgreSQL
(`make py-test-db`). Not covered: a token from a real Cognito pool.

## Continuous integration (`.github/workflows/ci.yml`)

Three jobs, all with read-only repository permissions, no secrets, and no AWS access:
`checks` (typecheck, lint, format, Vitest including the Lambda tests, build), `e2e` (Playwright
smoke, after `checks`), and `python` (Python 3.12, pinned `requirements-dev.txt`, a throwaway
PostgreSQL 16 service container; `make py-lint`, `py-format-check`, `django-check`,
`migrate-check`, `py-test-db`). `py-test-db` fails instead of skipping when the database is
unreachable, so a broken service cannot make the Python job pass silently. Test counts are
baselines, not asserted by CI.

## Django API conventions tests (LAI-0205)

`lai/apps/core/tests/test_api_conventions.py` drives real HTTP through the Django test client, using
throwaway routes in `tests/urls.py` (selected by the `api_urls` fixture): the error envelope for
validation, parse, media-type, authentication, permission, not-found, method, throttle, host, and
unexpected-exception cases; headers (`Allow`, `WWW-Authenticate`, `Retry-After`); request-ID
generation, acceptance, and rejection (including newline and over-length values); access-log
content, absence of secrets and query strings, and no duplicate lines; deny by default; and a
guard that only the health route is public and all routes are under `api/v1/`.

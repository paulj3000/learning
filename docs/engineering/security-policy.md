# Security Policy

Status: Mandatory policy
Owner: project owner
Last reviewed: 2026-11-18
Related ADRs: ADR-001, ADR-003, ADR-004, ADR-022, ADR-024, ADR-025, ADR-034, ADR-035, ADR-036, ADR-037, ADR-039, ADR-040, ADR-042, ADR-043, ADR-044, ADR-045, ADR-046, ADR-064, ADR-072
Canonical sources: [AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md), [ARCHITECTURE.md](../ARCHITECTURE.md) ("Django API conventions", "Authentication architecture", "Tenant isolation", "Logging and privacy"), [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) (LAI-0402, LAI-0403, LAI-0208 sections), [THREAT_MODEL.md](../THREAT_MODEL.md), [PRIVACY_AND_SAFETY_REVIEW.md](../PRIVACY_AND_SAFETY_REVIEW.md), [AI_SERVICE.md](../AI_SERVICE.md)

The product serves children aged 3 to 8. Security and privacy rules here are mandatory for every
task and every agent. They point to the canonical documents instead of copying them. Where a
canonical document is older than the Django backend (the Phase 8 threat model and privacy
review were written against Amplify), the Django rules on this page and in
[ARCHITECTURE.md](../ARCHITECTURE.md) apply.

## 1. Legal and regulatory status

This repository makes **no claim** of compliance with COPPA, GDPR (including Article 8 and the
UK Age Appropriate Design Code), CCPA/CPRA, FERPA, or any other law or standard. Each of these
**requires legal and owner review** before the product handles real children's data. Open
prerequisites include `ParentConsent` design (ADR-019 gate G9, LAI-0308), retention periods,
and deployed-logging verification (gate G10). Do not write "compliant" in code, copy or docs.

## 2. Child privacy

| Rule | Where enforced |
|---|---|
| Collect the minimum. A child profile has a nickname, age band, optional interests and an optional photo; no email, no login, no birth date beyond the age band. | ADR-022, `lai/apps/users/models.py` |
| No open-ended chat, no child-to-child messaging, no public profiles, no voice cloning, no emotion inference, no facial recognition. | ADR-004, CLAUDE.md section 12 |
| Do not send full child profiles or history to a model; send only server-derived age band, objective, template and bounded fields. | ADR-044 item 5, [AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md) "Prompt context minimization" |
| Parent dashboards summarize by skill, not raw transcripts. | CLAUDE.md section 11 |
| Use synthetic data only in tests, fixtures, screenshots, docs and Trello. Never real family data. | This policy |

## 3. Ownership boundaries and authorization

| Rule | Detail |
|---|---|
| Deny by default | DRF default permission is `IsAuthenticated`; only the health route is public. A test fails if another route becomes public. |
| Parent owns children | A parent reaches only their own `ChildProfile` rows and records under them (ADR-001, ADR-039). |
| Child-scoped endpoints | Under `/api/v1/children/<uuid:child_id>/...`, built on `ChildScopedMixin` (`lai/apps/users/scoping.py`). Another family's child and an unknown id give the identical 404. Ids in bodies or query strings are ignored. |
| Nested records | A record id that belongs to another child of the same parent is 404. |
| Admins | The Cognito `Admins` group gets no cross-family API access. Staff use Django Admin with its own sign-in and per-model permissions (ADR-034, ADR-040). Child-owned data is visible in Django Admin only where an ADR allows it (ADR-039 profile view, ADR-044 item 9 AI audit), read-audited. |
| Game session cookie | One child, one region, runtime routes only, writes need `X-LAI-Game-CSRF` (ADR-036, `lai/apps/game_sessions/runtime_auth.py`). |
| Tests are mandatory | Every new child-scoped endpoint has the eight LAI-0403 checklist tests ([TESTING_STRATEGY.md](../TESTING_STRATEGY.md) "Child-scoped endpoint checklist"). Reviewers still read new endpoints: structural guards are not proof. |

## 4. Least privilege

- Code: each Django app writes only its own tables; the `ai` app writes only `ai_*` rows
  (ADR-044 item 6). Lambda workers never touch the database and never publish (ADR-064).
- Staff: Django groups created by the `ensure_*_roles` management commands (Studio author,
  reviewer, publisher; asset editor, publisher; and so on). Grant the smallest group that works.
- AWS: one role per workload with resource-scoped actions ([CANONICAL_PATH.md](../processing/CANONICAL_PATH.md) "IAM"); GitHub Actions use OIDC roles, no stored AWS keys (ADR-037); CI has `contents: read` and no secrets.

## 5. Authentication and sessions

| Item | Rule |
|---|---|
| Parent sign-in | Cognito user pool, SRP from the browser (`react/src/lib/cognito`). No Amplify. |
| Token verification | Django verifies access tokens: signature by JWKS (`lai/apps/users/jwks.py`, https only, cache, fail closed), issuer, client id, `token_use`, expiry. ID tokens and query-string tokens are refused. |
| Token storage | Browser `localStorage` under the keys the client uses today (`react/src/lib/cognito/auth.ts`). Any change needs an ADR. |
| Sensitive actions | Recent interactive sign-in (`auth_time`, per-session anchor, `GetUser` revocation check) in `lai/apps/users/recent_auth.py`; ADR-043 is Proposed and its live Cognito gate is open. |
| Game tickets and cookie | Settings `LAI_GAME_TICKET_TTL_SECONDS` (default 60, bounded 10 to 300), `LAI_GAME_SESSION_TTL_SECONDS` (default 3600), `LAI_GAME_COOKIE_SECURE` (default true; never false outside local HTTP), `LAI_GAME_ALLOWED_ORIGINS`, `LAI_GAME_LAUNCH_RATE` throttle. Cookie is HttpOnly, Secure, SameSite=Strict, path `/api/v1/`. Tickets are single use. |
| Django Admin | Local staff accounts, password validators, admin URL path from `DJANGO_ADMIN_URL_PATH`. Created with `make createsuper`, never with shared credentials. |
| Child login | Not implemented and not decided. Do not add one ([architecture-rules.md](architecture-rules.md) section 6.1). |

## 6. Server-side validation

- Every request body goes through a serializer with closed fields. The client is never trusted
  for correctness, progress, rewards, age band, limits or ownership.
- Gameplay answers, hints, quest progress, rewards and world changes are decided by Django
  (ADR-012, ADR-051). The engine only emits events.
- Uploaded files are validated from their bytes, not their names or declared types (section 11).

## 7. Secret management

| Rule | Detail |
|---|---|
| Never in source, docs, fixtures, tests, logs, commit messages, pull requests, Trello cards or chat | Includes API keys, passwords, tokens, signing keys, connection strings with passwords, AWS account credentials. Use `<placeholder>` in templates. |
| Local | `.env` at the repository root, untracked; `.env.sample` holds names and placeholders only. |
| Deployed | SSM Parameter Store `SecureString` under `/lai/<env>/...` and Secrets Manager (the RDS master secret is generated by the stack). [DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md) section 4.3. |
| Agent sessions | Credentials an agent needs are entered by the owner as environment network secrets through the session's secure credential form, never pasted into chat or files. Agents do not run AWS calls (CLAUDE.md section 18). |
| CI | No secrets in `ci.yml`. The PostgreSQL password there is a throwaway service-container value. |
| On exposure | Treat any committed secret as compromised: tell the owner, rotate it, then remove it. Rewriting history alone is not enough. |

## 8. AI safety

The ten layers in [AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md) are mandatory. On Django
(ADR-044, [AI_SERVICE.md](../AI_SERVICE.md)):

| Control | Rule |
|---|---|
| Server only | No model call from the browser. All AI goes through `lai/apps/ai`. Local and test use the fake provider (`LAI_AI_PROVIDER=fake`). |
| Guardrail | A Bedrock Guardrail is mandatory: missing configuration fails closed (production refuses to start; elsewhere the turn falls back). PII blocked. |
| Structured output | Explicit contracts (`lai/apps/ai/contracts.py`) for dialogue, choices, hints and safety disposition; schema-validated before use. |
| Output policy | Django boundary-language policy (`lai/apps/ai/content_safety.py`): no secrecy, dependency, claims of being human, impersonation, diagnosis, contact details, learning judgments. |
| Fallbacks | Every response has authored fallback content (`lai/apps/ai/fallbacks.py`); every failure is a 200 with safe content. |
| AI never writes gameplay state | AI cannot grade, award or unlock. |
| Limits and cost | Per-child rate limits and global daily ceiling in PostgreSQL counters; kill switch `AIServiceControl`. |
| Live use | Live Bedrock calls, Guardrail changes and `npm run ai:red-team` (which calls the live endpoints) need owner approval. |

### 8.1 Prompt injection resistance

- Treat all client-supplied text as untrusted data: screen it, bound its length, wrap it in
  `guardContent` (ADR-044 item 4), and never place it in the system prompt.
- Prefer server-derived context (`DJANGO_SESSION`, `DJANGO_CATALOG`); `CLIENT_AUTHORED` is
  transitional and recorded on every audit row.
- Never let model output choose actions outside the allowlisted ids for the step; validation
  rejects unknown ids.
- Staff-authored prompts (Question Studio, NPC personas) are versioned and reviewed in Django
  Admin; generated questions are validated deterministically and published by a human (ADR-046).
- Add a prompt-injection case to the AI tests whenever a new input path reaches a model.

### 8.2 Moderation and content publishing

- Children cannot publish anything visible to other families. No user-generated public content.
- Content, assets, sound, NPC releases and Studio questions publish only through Django Admin
  with publish permissions held by named staff groups (ADR-045, ADR-046, ADR-047, ADR-054).
- `SafetyEvent` review status is the only editable field on AI audit data in Django Admin.

## 9. Data retention

| Data | State |
|---|---|
| AI audit and safety rows | No retention period approved. `manage.py ai_retention` deletes only with an explicit period and `--apply` (`lai/apps/ai/retention.py`). |
| Child photos | Private bucket with 7-day version retention in the defined stack (ADR-042, [CHILD_PHOTO_STORAGE.md](../platform/CHILD_PHOTO_STORAGE.md)). |
| Child and account deletion | Implemented with recent-sign-in protection; see [RECENT_SIGN_IN.md](../platform/RECENT_SIGN_IN.md). |
| Retained Amplify data | Untouched until an approved import and retirement. |
| Overall retention schedule | **Requires legal and owner review** (gate G9). |

## 10. Sensitive logging

Mandatory rules are in [coding-standards.md](coding-standards.md) section 9. In short: no child
free text, audio, names, nicknames, interests, emails, tokens, cookies, bodies, raw paths or
query strings; exceptions as type and location only (ADR-025). The deployed side (access logs,
load balancer and CDN logs, PostgreSQL server log, CloudWatch retention) is unverified: gate G10.
Child UUIDs appear in URL paths, so infrastructure logs are not identifier-free by default.

## 11. Uploads, file metadata and object storage

| Upload | Validation on `main` | Metadata |
|---|---|---|
| Child photo (parent upload) | One 8-bit JPEG, structure parsed in pure Python, size and dimension limits, no trailing bytes (`lai/apps/users/photo_validation.py`). The browser re-encodes to 256 px first. | **Stripped on the server**: EXIF and XMP (including GPS), ICC, IPTC, maker notes, comments and thumbnails are removed. |
| Asset library images (staff upload, PNG, JPEG, WebP) | Format from leading bytes, bounded structure walk, no polyglots, dimension limits (`lai/apps/assets/validation_media.py`). | **Not stripped.** The validator reads structure only and the stored object keeps the uploaded bytes, so EXIF and GPS in a staff image are retained. Verified by reading the code on `main` at `466a4972`; reported in LAI-LAMBDA-013a, under review. Until fixed, staff must strip metadata before upload and must never upload photographs of real people. |
| 3D models (GLB) | Header, JSON chunk, extension allowlist, counted limits, embedded texture types (`lai/apps/assets/validation.py`). | Embedded textures are not stripped either (same finding). |
| Audio | Format and structure checks, channel, sample-rate and duration limits. | Tags not stripped. |

Storage rules:

- Separate private buckets for assets and child photos; Django is the control plane (ADR-042).
  No public buckets, no public object ACLs.
- Child-facing delivery uses signed, expiring URLs or Django delivery routes
  (`LAI_ASSET_URL_TTL_SECONDS`); only published assets resolve (ADR-035).
- Max upload sizes are settings (`LAI_ASSET_MAX_UPLOAD_BYTES`, `LAI_CHILD_PHOTO_MAX_BYTES`).
- Never run a native image decoder on untrusted bytes in the API process.

## 12. Audit logging

| Record | Purpose | Rule |
|---|---|---|
| `AIInteractionAudit` | Metadata of each AI turn: route, template, age band, schema result, safety disposition, fallback reason, context source | Server-written, closed vocabularies, no child text. |
| `SafetyEvent` | Safety-relevant AI outcomes for review | Child UUID only; review status editable by permitted staff only. |
| Django Admin read audit | Reads of child-owned records in admin | Required wherever an ADR allows such a view. |
| Content revisions | Who published what and when | Immutable `ContentRevision` rows (ADR-047). |

## 13. Dependency security

- No new dependency without approval ([coding-standards.md](coding-standards.md) section 12).
- Python dependencies are pinned with `==` including transitive ones; npm installs from the
  lockfile with `npm ci`.
- No automated vulnerability scanning runs in CI on `main` today. Review lockfile diffs in every
  pull request; adding a scanner is an owner decision.
- Upgrades that touch authentication, crypto, JWT, Django, DRF or boto3 are their own task.

## 14. Production protections

- No deployment, AWS resource change, data migration or Cognito change without explicit owner
  approval (CLAUDE.md section 18; ADR-019 gate G7). Agents never trigger deploy workflows.
- Production settings force `DEBUG=False` and turn raw exception logging off; the privacy tests
  assert this.
- Deploy workflows are gated by repository variables (`LAI_DEPLOY_ENABLED`,
  `LAI_SITE_DEPLOY_ENABLED`) and run in named GitHub environments; never change those gates.
- Destructive migrations ship in their own approved release.
- Report suspected vulnerabilities or data exposure to the owner immediately, with no family
  data in the report.

# Security Policy

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-022, ADR-024, ADR-025, ADR-037, ADR-040, ADR-042, ADR-043, ADR-044

Learning Adventure Island serves children ages 3 to 8. Security and privacy are architecture,
not a final review step: safety must never depend on a single prompt, model response or client
check. **Binding:** CLAUDE.md §4 pillar 5.

This page is the governance summary. It does not restate the detailed reviews; it links to them.
Rules tagged **Binding** already apply; untagged rules are proposals under ADR-072.

**No compliance claim.** Nothing in this repository certifies compliance with COPPA, GDPR-K, the
UK Age Appropriate Design Code or any other law. Do not write "compliant" in code, docs, copy or
release notes. Items that need legal or owner review are listed in section 16.

## 1. Canonical security documents

| Document | Use it for | Note |
|---|---|---|
| [THREAT_MODEL.md](../THREAT_MODEL.md) | Assets, actors, trust boundaries, threats | Phase 8, written against the Amplify backend; Django controls are in ARCHITECTURE.md |
| [PRIVACY_AND_SAFETY_REVIEW.md](../PRIVACY_AND_SAFETY_REVIEW.md) | Code-level check of the AI and child-safety requirements | Phase 8; re-check Django paths against it |
| [AUTHORIZATION_REVIEW.md](../AUTHORIZATION_REVIEW.md) | Authorization classification (ADR-014) | Reviews the retired Amplify schema; Django rules are in ARCHITECTURE.md "Tenant isolation" |
| [AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md) | Ten safety layers, child input policy, companion boundaries | Product requirements, not legal advice |
| [PROMPT_AND_SCHEMA_GUIDE.md](../PROMPT_AND_SCHEMA_GUIDE.md) | Prompt composition and output schemas | |
| [AI_SERVICE.md](../AI_SERVICE.md) | Django AI pipeline, Guardrail, audit, retention | ADR-044 |
| [IAM_ROLE_AUDIT.md](../IAM_ROLE_AUDIT.md) | Role inventory and least privilege | Repository evidence only |
| [CHILD_PHOTO_STORAGE.md](../platform/CHILD_PHOTO_STORAGE.md) | Photo upload, storage, deletion | ADR-042 |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | "Tenant isolation", "Logging and privacy", "Django Admin" | Current Django controls |

## 2. Child privacy

- Collect the least data for the shortest useful time. A child profile holds no email, password or
  login. **Binding:** ADR-022, AI_AND_CHILD_SAFETY.md "Data retention principle".
- Do not send full child profiles or unnecessary history to a model; no persistent free-form
  conversation memory in the MVP. **Binding:** CLAUDE.md §7.
- Parent dashboards summarize by skill, never raw chat transcripts. **Binding:** CLAUDE.md §11
  item 10.
- Out of scope unless separately approved: facial recognition, emotion inference, voice cloning,
  child-to-child messaging, public profiles, advertising. **Binding:** CLAUDE.md §12.
- Analytics and telemetry carry no sensitive content. **Binding:** CLAUDE.md §15.

## 3. Ownership boundaries

- A parent reaches only their own child profiles and associated records. Every child read goes
  through the parent (`ChildProfile.objects.owned_by`, `apps/users/services.py`,
  `ChildScopedMixin`). **Binding:** CLAUDE.md §10, ADR-022.
- A foreign id and an unknown id return the identical 404 (no probing). A nested record that
  belongs to a sibling child is also 404. **Binding:** TESTING_STRATEGY.md (LAI-0403).
- Cross-child links are refused by `ChildOwnedModel` (`lai/apps/core/models.py`).
- The `Admins` Cognito group grants no cross-family access to child data. Django Admin profile
  inspection is read-only, permission-gated and audited. **Binding:** ADR-039, LAI-0403 item 7.
- Children never query administrative records or raw AI audit data. **Binding:** CLAUDE.md §10.

## 4. Authentication and authorization

- Cognito is the sole identity provider for application users; Django verifies access tokens
  (issuer, audience, signature, expiry, token use) and fails closed. Children never authenticate.
  **Binding:** ADR-024, ADR-040, ADR-022.
- Django Admin uses separate local staff sign-in with password validators. **Binding:** ADR-034.
- **Deny by default.** The DRF default permission is `IsProvisionedParent`; only the health view is
  public, and a test fails if another route becomes public. **Binding:** CLAUDE.md §10, LAI-0205.
- **Child-scoped endpoint checklist.** Every new `/api/v1/children/<uuid:child_id>/...` endpoint
  passes all eight items of the LAI-0403 checklist in
  [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) using the `lai/conftest.py` fixtures. Reviewers
  still read every new endpoint: the structural guards are not proof. **Binding:**
  TESTING_STRATEGY.md.
- Authorization is decided on the server from the token and URL, never from ids in the body or
  query string. **Binding:** LAI-0403 item 5.
- Admin access is group-based and explicit; destructive admin operations need superuser.

## 5. Server-side validation

- Every external input is validated on the server by a serializer or domain validator. Client
  validation is a convenience. **Binding:** CLAUDE.md §13.
- Gameplay correctness, hint levels, rewards and progress are computed by Django on every
  server-authoritative path; a client-computed value is never trusted. **Binding:** ADR-012,
  CLAUDE.md §7.
- Retries are idempotent through `requestId` where the endpoint defines one (ADR-015 design,
  implemented for answers).

## 6. Session management

- Browser sessions are Cognito tokens handled by `react/src/lib/cognito`; there is no Django
  session authentication for the API and no CORS (same-origin through CloudFront). **Binding:**
  ARCHITECTURE.md "Django API conventions".
- Sensitive actions (child deletion today) require a recent interactive sign-in
  (`RequiresRecentAuthentication`, `LAI_RECENT_AUTH_MAX_AGE_SECONDS`, 60 to 900 seconds).
  Implemented on `main`; ADR-043 is **Proposed** and its live Cognito gate is pending.
- The ADR-036 game session cookie is child- and region-scoped, ticket-redeemed and accepted only by
  game runtime routes. Implemented on `main`; ADR-036 is **Proposed**.
- No play-time limit, countdown or forced session cutoff for children. **Binding:** ADR-053.

## 7. Secrets

- No secret, credential, token, private key or real password in source, docs, fixtures, test
  data, commit messages, Trello cards, PR text, logs or agent permission files
  (`.claude/settings.json` allow rules are committed text). CI values that look like secrets are
  marked "not a secret" and are throwaway (see `.github/workflows/ci.yml`).
- Local secrets live in the untracked root `.env`; deployed secrets live in SSM Parameter Store.
  **Binding:** Makefile header, [DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md).
- Nothing secret goes in a `VITE_*` variable; the Cognito web client id is public by design.
- If a secret is committed, treat it as compromised: tell the owner, rotate it, then clean history
  only with owner approval.

## 8. AWS IAM

- GitHub Actions reach AWS through GitHub OIDC with no stored AWS keys (`infra/lib/githubOidc.ts`).
  **Binding:** ADR-037.
- CI jobs have read-only repository permissions, no secrets and no AWS access. **Binding:**
  TESTING_STRATEGY.md "Continuous integration".
- Roles name exact actions and resources. Django has no `s3:DeleteObjectVersion` on the photo
  bucket; Lambda workers have no database access and write only their own S3 prefix (ADR-064).
- Agents never change AWS resources. The tracked `.claude/settings.json` denies mutating AWS CLI
  verbs (`create-`, `delete-`, `put-`, `update-`, `deploy`, `run-` and others) and allows only a
  few named read-only calls. Every deploy and resource change is owner-approved. **Binding:**
  CLAUDE.md §18.

## 9. Data retention and deletion

- Child deletion removes S3 photos first, then cascades every child-owned row
  (`lai/apps/users/deletion.py`); a parent cannot be deleted while children exist.
- AI audit retention has **no approved period** (LAI-0308, gate G9). `manage.py ai_retention`
  deletes nothing by default. Do not add scheduled deletion or a new retention period without the
  privacy design.
- Before collecting any new free text or audio, document its retention and deletion.
  **Binding:** AI_AND_CHILD_SAFETY.md.

## 10. Sensitive logging

Exceptions are logged as type and location, never message; request lines use the route pattern;
no bodies, headers, cookies, tokens, query strings, child names or free text. **Binding:**
ADR-025, CLAUDE.md §13. Tests: `apps/core/tests/test_privacy_logging.py` (LAI-0208). Details in
[coding-standards.md](coding-standards.md) section 5.

## 11. AI safety and prompt injection

- Every model call goes through Django's pipeline in `lai/apps/ai`; never from the browser; no
  model credentials on the client. **Binding:** CLAUDE.md §7.
- Every request carries an adventure template id, age band, allowed topic, learning objective and
  maximum output length. Output uses explicit schemas and is validated by application code; every
  response has an authored fallback, and every failure returns authored content. **Binding:**
  CLAUDE.md §7, ADR-003, ADR-044.
- The Bedrock Guardrail is mandatory: no Guardrail, no model call. A Django output policy blocks
  boundary language (secrecy, dependency, claims of being human, diagnosis, contact details).
  **Binding:** ADR-044, AI_AND_CHILD_SAFETY.md.
- Prompt injection resistance: child input is limited in mode and length, screened before the
  model, placed in a delimited data section of a versioned template, and never allowed to change
  the action set; output actions are allowlisted ids. Follow
  [PROMPT_AND_SCHEMA_GUIDE.md](../PROMPT_AND_SCHEMA_GUIDE.md).
- No open-ended child chat. **Binding:** ADR-004, CLAUDE.md §12.
- Correctness is decided by code, never by the model, including Question Studio questions.
  **Binding:** CLAUDE.md §7, ADR-046.
- The live red-team suite `npm run ai:red-team` calls deployed Django AI endpoints. It is a gated
  check run only with owner authorization and a configured environment.

## 12. Moderation and content publishing

- Flagged interactions become `SafetyEvent` rows for admin review; concerning content gets a calm
  redirect to a trusted grown-up, never interrogation. **Binding:** AI_AND_CHILD_SAFETY.md.
- Only staff publish content, through Django Admin revisions with Django permissions; there is no
  user-generated public content. **Binding:** ADR-045, ADR-047, CLAUDE.md §12.
- AI-drafted questions pass deterministic validation and human approval before publication.
  **Binding:** ADR-046.

## 13. Uploads, file metadata and object storage

- **Asset uploads** (`lai/apps/assets/validation.py`): format from bytes, not name; bounded reads
  (`LAI_ASSET_MAX_UPLOAD_BYTES`); only embedded `data:` URIs; nothing fetched or executed.
- **Child photos** (`lai/apps/users/photo_validation.py`): JPEG only, structurally parsed, size and
  dimension limits, nothing after end of image. Implemented on `main`: every metadata segment is
  stripped before storage (EXIF including GPS, XMP, ICC, IPTC, maker notes, comments, thumbnails).
  The server does not decode pixels; the client re-encode produces them.
- **Storage:** game assets and child photos use separate private S3 buckets, delivered through
  Django-signed URLs with short TTLs; no public bucket. **Binding:** ADR-035, ADR-042. Both buckets
  are defined in `infra/`; neither is recorded as deployed.

## 14. Audit logging

| Record | Where | Content |
|---|---|---|
| `AIInteractionAudit` | `lai/apps/ai/models.py` | Metadata of AI turns, written by the server |
| `SafetyEvent` | `lai/apps/ai/models.py` | Flagged events with review status |
| Admin inspection audit | `lai.admin_audit` logger (`lai/apps/users/admin.py`) | Who viewed which profile record, ids only |
| Question Studio review | `question_studio.ReviewEvent` | Staff review actions |
| Content revisions | `catalog.ContentRevision` | Who published what version |

Audit records hold ids and metadata, never child free text beyond what a documented design
allows.

## 15. Dependency security and production protections

- Pin and review dependencies ([coding-standards.md](coding-standards.md) section 11). CI runs no
  dependency vulnerability scanner today; adding one is an owner decision.
- Production settings force `DEBUG=False` and raw tracebacks off; security headers
  (`nosniff`, `X-Frame-Options: DENY`, referrer policy) are set in `base.py`. **Binding:** ADR-025.
- Prod CDK stacks have termination protection and retained data buckets.
- Never weaken a security or privacy test to make a change pass. **Binding:** TESTING_STRATEGY.md.

## 16. Items needing legal or owner review

1. Any regulatory position (COPPA, GDPR, UK AADC) and parental consent (`ParentConsent`, LAI-0308).
2. Retention periods for AI audit data and safety events (gate G9).
3. The escalation policy for concerning child content.
4. Acceptance of ADR-036 and ADR-043 (implemented, Proposed) and the live Cognito gate.
5. A dependency and secret scanning tool in CI.
6. Refreshing THREAT_MODEL.md and AUTHORIZATION_REVIEW.md for the Django backend.
7. Any pre-launch independent security and privacy review, which AI_AND_CHILD_SAFETY.md and
   THREAT_MODEL.md both require.

## 17. Reporting a security issue

Stop, do not exploit or publish it, record it as a defect with severity Critical using
[defect-report.md](templates/defect-report.md) without reproducing secrets or child data, and tell
the owner.

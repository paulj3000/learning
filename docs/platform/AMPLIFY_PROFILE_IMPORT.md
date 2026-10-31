# Amplify profile import runbook (LAI-CHILD-001, ADR-039)

Moves existing Amplify `ParentProfile` and `ChildProfile` records into Django without losing or
duplicating anything. **Running it against production data is a Phase 11/12 task (LAI-1102,
LAI-1202, LAI-1203) and needs explicit approval.** Nothing in LAI-CHILD-001 ran it outside tests.

## What it does and does not do

- Reads a JSON export file. It never calls AWS, DynamoDB or Cognito.
- Default is a **dry run**: it reads the database and the file and writes nothing.
- `--apply` re-plans and writes the planned creations in **one transaction**. A failure writes
  nothing. A second run creates nothing new (idempotent by id).
- Never overwrites, moves or deletes an existing Django row. Every difference is reported.
- Never matches anyone by email. The export may contain emails (Amplify's `owner` field ends in
  `::<username>`, often an email); the command reads only the part before `::`.

## Export format

Produced by the read-only DynamoDB export (LAI-1101). Plain JSON, Amplify attribute names:

```json
{
  "parentProfiles": [{"id": "...", "owner": "<cognito sub>::<username>", "displayName": "...", "timezone": "..."}],
  "childProfiles": [{"id": "<uuid>", "parentProfileId": "...", "ownerSub": "<cognito sub>",
                     "nickname": "...", "ageBand": "SPROUT", "avatarKey": "FOX", "avatarPhotoKey": null,
                     "interests": ["Space"], "readingMode": "VOICE_FIRST", "sessionMinutes": 6,
                     "active": true, "aiEnabled": null, "createdAt": "2026-05-01T09:30:00.000Z"}]
}
```

The export contains child data: keep it on an encrypted, access-controlled machine, never in the
repository, and delete it after the cutover.

## How each record is resolved

**Owner.** The child's `ownerSub`, else the Cognito sub from its `ParentProfile.owner`. If both
exist and differ: `owner_mismatch`. Neither: `unresolved_owner`. The sub must belong to an
existing, active, non-staff `ParentAccount`; otherwise `parent_not_provisioned` (or, with
`--provision-parents`, the account is created exactly as the first sign-in would create it).
Staff and inactive accounts are `account_not_eligible`.

**Child outcomes.**

| Outcome | Meaning | Written? |
|---|---|---|
| `create` | New; keeps its Amplify id and `createdAt` | with `--apply` |
| `unchanged` | Already in Django with the same owner and settings | no |
| `differs` | Same id and owner, different settings (fields listed) | no: a person decides |
| `conflict_other_parent` | The id belongs to another Django parent | no |
| `possible_duplicate` | The owner already has a child with the same nickname and age band under another id | no |
| `limit_reached` | Would exceed three profiles | no |
| `invalid` | Fails the API's own validation (fields listed) | no |
| `invalid_id` / `duplicate_in_export` | Not a UUID / the same id twice in the file | no |

Optional Amplify fields get their accepted defaults: missing `active` or `aiEnabled` is `true`,
missing `interests` is `[]`.

**Parent profile.** A blank Django display name or time zone is filled from Amplify; a non-blank
one is kept (`kept_display_name`). Invalid values are skipped and reported.

**Photos.** `avatarPhotoKey` is not copied: the objects stay in Amplify Storage until LAI-1103.
The report counts them (`photosLeftInAmplifyStorage`).

**Gameplay ids.** Because ids are preserved, any Django progress already stored for a child
(Treasure Rush sessions, rewards, mastery) stays attached through its foreign key. A Django child
created before the import under a *different* id, for the same real child, shows up as
`possible_duplicate`; reconcile it by hand before applying (decide which id survives; Django rows
cascade from the child, so never delete one with progress you want to keep).

## Steps

```bash
cd lai
../.venv/bin/python manage.py import_amplify_profiles /secure/export.json --report /secure/plan.json
# review plan.json: ids and outcomes only, no names
../.venv/bin/python manage.py import_amplify_profiles /secure/export.json --apply --report /secure/applied.json
../.venv/bin/python manage.py import_amplify_profiles /secure/export.json   # expect only "unchanged"
```

Rehearse on a restored copy first (LAI-1202). Resolve every non-`create`, non-`unchanged` outcome
before the production run, and keep both reports with the cutover record.

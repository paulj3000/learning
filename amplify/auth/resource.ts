import { defineAuth } from '@aws-amplify/backend';

/**
 * Parent accounts only (ADR-001). Child profiles are application records
 * owned by an authenticated parent, not independent Cognito identities.
 *
 * The `Admins` Cognito user group backs the read-only administrator section
 * (CLAUDE.md section 2/10, `docs/AUTHORIZATION_REVIEW.md` section 4.3): a
 * user's own account is a normal parent account (there is no separate admin
 * identity type), and membership in this group is what an
 * `allow.group('Admins')` rule in `amplify/data/resource.ts` checks. There
 * is deliberately no self-serve UI to join this group — per CLAUDE.md
 * section 10 ("Admin access must be group-based and explicitly
 * authorized"), granting it is an out-of-band operator action:
 * `aws cognito-idp admin-add-user-to-group --user-pool-id <pool id>
 * --username <email> --group-name Admins`, or the wrapper that reads the
 * pool id out of `amplify_outputs.json` for you:
 * `npm run grant-admin -- <email>` (`scripts/grant-admin.ts`).
 *
 * `Superusers` (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 3, ADR-024) is
 * not a second role system: a Superuser is an `Admins` member who is also in
 * `Superusers`, so every existing `allow.group('Admins')` rule already covers
 * them and the extra group only ever adds destructive permissions (today,
 * deleting an `Adventure` catalog record). Granted the same out-of-band way:
 * `npm run grant-admin -- <email> --superuser`.
 * @see https://docs.amplify.aws/react/build-a-backend/auth/
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['Admins', 'Superusers'],
});

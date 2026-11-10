/**
 * Grants a parent account membership in the `Admins` Cognito group, which is
 * what unlocks the read-only admin section (`/admin`).
 *
 * There is deliberately no in-app way to do this: CLAUDE.md section 10
 * requires admin access to be group-based and explicitly authorized, so the
 * grant is an out-of-band operator action. This script is that action. The
 * pool comes from `COGNITO_USER_POOL_ID` (the region is its prefix), the
 * same value the site build uses as `VITE_COGNITO_USER_POOL_ID` (AMP-02).
 *
 *   COGNITO_USER_POOL_ID=us-west-1_AbC123 npx tsx scripts/grant-admin.ts you@example.com
 *   npx tsx scripts/grant-admin.ts you@example.com --revoke
 *   npx tsx scripts/grant-admin.ts you@example.com --superuser
 *   npx tsx scripts/grant-admin.ts you@example.com --superuser --revoke
 *
 * `--superuser` targets the `Superusers` group instead (ADR-031). Granting it
 * also grants `Admins`, since a Superuser is an admin with extra destructive
 * permissions, not a separate role; revoking it removes only `Superusers`.
 *
 * Requires the AWS CLI on PATH and credentials for the account that deployed
 * the backend (`cognito-idp:ListUsers`, `AdminAddUserToGroup`,
 * `AdminRemoveUserFromGroup`, `AdminListGroupsForUser`).
 *
 * The granted user must sign out and back in before it takes effect:
 * `AuthContext` reads `cognito:groups` from the ID token, which is minted at
 * sign-in and does not change under a token already held.
 */
import { execFileSync } from 'node:child_process';
import { readCognitoConfig } from '../react/src/lib/cognito/config';

const ADMINS = 'Admins';
const SUPERUSERS = 'Superusers';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const superuser = args.includes('--superuser');
const GROUP = superuser ? SUPERUSERS : ADMINS;
const email = args.find((arg) => !arg.startsWith('--'));
if (!email) {
  console.error('Usage: npx tsx scripts/grant-admin.ts <email> [--superuser] [--revoke]');
  process.exit(2);
}

// The client id is not needed here; any valid placeholder satisfies the shared parser.
const pool = readCognitoConfig({
  VITE_COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
  VITE_COGNITO_CLIENT_ID: 'unused',
});
if (!pool) {
  console.error('Set COGNITO_USER_POOL_ID to the parent user pool id, e.g. us-west-1_AbC123.');
  process.exit(1);
}
const { userPoolId, region } = pool;

/** Runs the AWS CLI, surfacing its stderr rather than a bare exit code. */
function aws(cliArgs: string[]): string {
  try {
    return execFileSync('aws', [...cliArgs, '--region', region, '--output', 'json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const err = error as { stderr?: string; code?: string; message: string };
    if (err.code === 'ENOENT') {
      console.error('The AWS CLI is not on PATH. Install it, then re-run.');
      process.exit(1);
    }
    console.error((err.stderr || err.message).trim());
    process.exit(1);
  }
}

// Cognito's own username is a generated uuid when the pool logs in with
// email, so the address has to be resolved to it before the admin-* calls.
const escaped = email.replace(/"/g, '\\"');
const found = JSON.parse(
  aws([
    'cognito-idp',
    'list-users',
    '--user-pool-id',
    userPoolId,
    '--filter',
    `email = "${escaped}"`,
  ]),
) as { Users?: Array<{ Username: string; UserStatus: string }> };

const users = found.Users ?? [];
if (users.length === 0) {
  console.error(`No account for ${email} in ${userPoolId}. Sign up in the app first, then re-run.`);
  process.exit(1);
}
if (users.length > 1) {
  console.error(`${users.length} accounts share ${email}; resolve that in Cognito first.`);
  process.exit(1);
}
const { Username: username, UserStatus: userStatus } = users[0]!;

const targetGroups = superuser && !revoke ? [ADMINS, SUPERUSERS] : [GROUP];
for (const group of targetGroups) {
  aws([
    'cognito-idp',
    revoke ? 'admin-remove-user-from-group' : 'admin-add-user-to-group',
    '--user-pool-id',
    userPoolId,
    '--username',
    username,
    '--group-name',
    group,
  ]);
}

const groups =
  (
    JSON.parse(
      aws([
        'cognito-idp',
        'admin-list-groups-for-user',
        '--user-pool-id',
        userPoolId,
        '--username',
        username,
      ]),
    ) as { Groups?: Array<{ GroupName: string }> }
  ).Groups?.map((group) => group.GroupName) ?? [];

const inGroup = groups.includes(GROUP);
if (inGroup === revoke) {
  console.error(`${GROUP} membership for ${email} did not change as expected.`);
  process.exit(1);
}

console.log(`${email} (${username}) groups: ${groups.join(', ') || '(none)'}`);
if (userStatus !== 'CONFIRMED') {
  console.log(`Note: account status is ${userStatus}, so it cannot sign in yet.`);
}
console.log(
  revoke
    ? 'Revoked. The old ID token keeps its group claim until they sign out and back in.'
    : 'Granted. Sign out and back in to mint an ID token carrying the claim, then open /admin.',
);

/**
 * Grants a parent account membership in the `Admins` Cognito group, which is
 * what unlocks the read-only admin section (`/admin`).
 *
 * There is deliberately no in-app way to do this: CLAUDE.md section 10
 * requires admin access to be group-based and explicitly authorized, so
 * `amplify/auth/resource.ts` documents the grant as an out-of-band operator
 * action. This script is that action, wrapped so the user-pool id and region
 * come from `amplify_outputs.json` instead of being pasted by hand — sandbox
 * pools are torn down and recreated, so the id changes and a stale one
 * silently targets a pool that no longer exists.
 *
 *   npx tsx scripts/grant-admin.ts you@example.com
 *   npx tsx scripts/grant-admin.ts you@example.com --revoke
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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const GROUP = 'Admins';
const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const email = args.find((arg) => !arg.startsWith('--'));
if (!email) {
  console.error('Usage: npx tsx scripts/grant-admin.ts <email> [--revoke]');
  process.exit(2);
}

const outputsPath = resolve(__dirname, '../amplify_outputs.json');
let userPoolId: string;
let region: string;
try {
  const outputs = JSON.parse(readFileSync(outputsPath, 'utf-8'));
  userPoolId = outputs.auth?.user_pool_id;
  region = outputs.auth?.aws_region;
} catch {
  console.error(`Could not read ${outputsPath}. Run \`npm run sandbox\` first.`);
  process.exit(1);
}
if (!userPoolId || !region) {
  console.error('amplify_outputs.json has no auth.user_pool_id / auth.aws_region.');
  process.exit(1);
}

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

aws([
  'cognito-idp',
  revoke ? 'admin-remove-user-from-group' : 'admin-add-user-to-group',
  '--user-pool-id',
  userPoolId,
  '--username',
  username,
  '--group-name',
  GROUP,
]);

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

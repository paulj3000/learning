/**
 * Live persistence and generation smoke test.
 *
 * Every mocked test in this repo passes an object to a mocked data client
 * that happily accepts it. AppSync does not: an `a.json()` column is an
 * `AWSJSON` scalar and rejects a raw object outright, and a generation route
 * with no `bedrock:InvokeModel` grant fails with `AccessDeniedException`.
 * Both classes of failure shipped, were invisible to 1200+ unit tests, and
 * were found only by calling the deployed backend by hand:
 *
 * - all four `a.json()` writes were rejected, silently losing every NPC
 *   memory and loudly breaking story keepsakes and co-op;
 * - `generateTutorTurn` could not reach Bedrock at all, so Phase 27 served
 *   authored fallbacks 100% of the time while looking healthy.
 *
 * This script is the standing check for both. Run it after any schema
 * change, any new `a.json()` column, any new generation route, and before
 * any deploy that matters:
 *
 *   TEST_PARENT_EMAIL=you@example.com TEST_PARENT_PASSWORD='...' \
 *     npx tsx scripts/live-smoke.ts
 *
 * It writes and then deletes its own rows against whichever backend
 * `amplify_outputs.json` points at. Point it at a sandbox, never at
 * production data.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Amplify } from 'aws-amplify';
import { signIn, signOut } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { validateCompanionTurn } from '../src/features/companion/schema';
import { validateTutorTurn } from '../src/features/tutor/schema';
import { buildTutorContext } from '../src/features/tutor/context';
import { parseMemoryFlags } from '../src/features/npc/memory';
import { parseCoopSharedState } from '../src/features/coop/types';
import { decodeAwsJson, encodeAwsJson } from '../src/lib/awsJson';

const __dirname = dirname(fileURLToPath(import.meta.url));
Amplify.configure(JSON.parse(readFileSync(resolve(__dirname, '../amplify_outputs.json'), 'utf-8')));

const email = process.env.TEST_PARENT_EMAIL;
const password = process.env.TEST_PARENT_PASSWORD;
if (!email || !password) {
  console.error('Set TEST_PARENT_EMAIL and TEST_PARENT_PASSWORD.');
  process.exit(2);
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

await signOut().catch(() => undefined);
await signIn({ username: email, password });
const client = generateClient<Schema>({ authMode: 'userPool' });

const { data: children } = await client.models.ChildProfile.list();
const child = children.find((candidate) => candidate.active) ?? children[0];
if (!child) {
  console.error('This account has no child profile; create one before running the smoke test.');
  process.exit(2);
}
const childProfileId = child.id;
const now = new Date().toISOString();

// --- a.json() columns -------------------------------------------------------
//
// One case per column. Each writes through `encodeAwsJson`, reads back, and
// parses with the same function the app uses, so a regression in either half
// fails here rather than in a child's session.

{
  const { data, errors } = await client.models.ChildNpcState.create({
    childProfileId,
    npcId: 'smoke-npc',
    relationshipPoints: 1,
    relationshipLevel: 'STRANGER',
    memoryFlags: encodeAwsJson({ smokeFlag: true }),
    seenNodeIds: ['smoke-node'],
    firstMetAt: now,
    lastInteractedAt: now,
  });
  if (!data) check('ChildNpcState.memoryFlags', false, errors?.[0]?.message);
  else {
    const { data: read } = await client.models.ChildNpcState.get({ id: data.id });
    check('ChildNpcState.memoryFlags', parseMemoryFlags(read?.memoryFlags).smokeFlag === true);
    await client.models.ChildNpcState.delete({ id: data.id });
  }
}

{
  const { data, errors } = await client.models.StoryArtifact.create({
    childProfileId,
    sessionId: 'smoke-session',
    templateSlug: 'smoke',
    title: 'Smoke story',
    scenes: encodeAwsJson([{ stepId: 'a', text: 'once upon a time' }]),
    createdAt: now,
  });
  if (!data) check('StoryArtifact.scenes', false, errors?.[0]?.message);
  else {
    const { data: read } = await client.models.StoryArtifact.get({ id: data.id });
    const scenes = decodeAwsJson(read?.scenes);
    check('StoryArtifact.scenes', Array.isArray(scenes) && scenes.length === 1);
    await client.models.StoryArtifact.delete({ id: data.id });
  }
}

{
  const { data, errors } = await client.models.ChildStoryProgress.create({
    childProfileId,
    storyId: 'smoke-story',
    currentChapterId: 'c1',
    completedChapterIds: [],
    storyFlags: encodeAwsJson({ hero: 'fox' }),
    startedAt: now,
    lastPlayedAt: now,
  });
  if (!data) check('ChildStoryProgress.storyFlags', false, errors?.[0]?.message);
  else {
    const { data: read } = await client.models.ChildStoryProgress.get({ id: data.id });
    const flags = decodeAwsJson(read?.storyFlags) as Record<string, string> | null;
    check('ChildStoryProgress.storyFlags', flags?.hero === 'fox');
    await client.models.ChildStoryProgress.delete({ id: data.id });
  }
}

// --- co-op, including the Lambda that writes shared state -------------------
//
// `claimCoopSlot` is a Lambda that updates `sharedState.slots.<key>` by
// DynamoDB attribute path, so it and the client write have to agree on the
// stored shape. They are checked together here because a mismatch only shows
// up when both have run.
{
  const { data: session, errors } = await client.models.CoopSession.create({
    templateSlug: 'smoke',
    templateVersion: 1,
    participantChildProfileIds: [childProfileId],
    status: 'ACTIVE',
    sharedState: encodeAwsJson({ slots: {}, presence: [] }),
    startedAt: now,
    lastActivityAt: now,
  });
  if (!session) check('CoopSession.sharedState write', false, errors?.[0]?.message);
  else {
    const { data: read } = await client.models.CoopSession.get({ id: session.id });
    const state = parseCoopSharedState(read?.sharedState);
    check('CoopSession.sharedState round-trip', state.slots !== undefined);

    const claim = await client.mutations.claimCoopSlot({
      coopSessionId: session.id,
      slotKey: 'smoke-slot',
      childProfileId,
    });
    const claimed = claim.data ? parseCoopSharedState(claim.data.sharedState) : null;
    check(
      'claimCoopSlot writes a shape the client can read back',
      claimed?.slots['smoke-slot'] === childProfileId,
      claim.data ? JSON.stringify(claimed) : `no data: ${claim.errors?.[0]?.message}`,
    );
    await client.models.CoopSession.delete({ id: session.id });
  }
}

// --- generation routes ------------------------------------------------------
//
// Each route is called for real and its raw reply scored with the same
// validator production uses, so a missing IAM grant, a disabled model, or a
// prompt that drifted out of contract all fail here.
{
  const maxLength = 200;
  const { data, errors } = await client.generations.generateCompanionTurn({
    ageBand: 'PATHFINDER',
    intent: 'HINT',
    stepSummary: 'Counting planks on a broken bridge.',
    maxLength,
    hintLevel: 1,
  });
  if (!data) check('generateCompanionTurn reaches Bedrock', false, errors?.[0]?.message);
  else {
    check('generateCompanionTurn reaches Bedrock', true);
    const result = validateCompanionTurn(data, { maxLength, expectedIntent: 'HINT' });
    check(
      'generateCompanionTurn output passes validation',
      result.valid,
      result.valid ? result.turn.spokenText : result.reason,
    );
  }
}

{
  const context = buildTutorContext({
    ageBand: 'PATHFINDER',
    skillId: 'counting-sets',
    hintLevel: 3,
  });
  if (!context) check('tutor context builds', false, 'no context for counting-sets');
  else {
    const { data, errors } = await client.generations.generateTutorTurn({
      ageBand: context.ageBand,
      strategy: context.strategy,
      maxLength: context.maxLength,
      skillTitle: context.skillTitle,
      skillDescription: context.skillDescription,
      allowedVocabulary: [...context.allowedVocabulary],
      knownPrerequisiteTitles: [...context.knownPrerequisiteTitles],
      allowedRepresentations: [...context.allowedRepresentations],
      hintLevel: context.hintLevel,
    });
    if (!data) check('generateTutorTurn reaches Bedrock', false, errors?.[0]?.message);
    else {
      check('generateTutorTurn reaches Bedrock', true);
      const result = validateTutorTurn(data, context);
      check(
        'generateTutorTurn output passes validation',
        result.valid,
        result.valid ? result.turn.spokenText : result.reason,
      );
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
await signOut();
process.exit(failed === 0 ? 0 : 1);

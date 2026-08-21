import { deleteUser } from 'aws-amplify/auth';
import { client } from '../../lib/data-client';
import { removeChildPhoto } from './avatarPhoto';
import type { Schema } from '../../../amplify/data/resource';

type AdventureSession = Schema['AdventureSession']['type'];
type AdventureAction = Schema['AdventureAction']['type'];
type SkillEvidence = Schema['SkillEvidence']['type'];
type SkillProgress = Schema['SkillProgress']['type'];
type WorldChange = Schema['WorldChange']['type'];
type AIInteractionAudit = Schema['AIInteractionAudit']['type'];
type SafetyEvent = Schema['SafetyEvent']['type'];
type StoryArtifact = Schema['StoryArtifact']['type'];
type CompanionProfile = Schema['CompanionProfile']['type'];
type ChildStoryProgress = Schema['ChildStoryProgress']['type'];
type ChildNpcState = Schema['ChildNpcState']['type'];
type ChildInventory = Schema['ChildInventory']['type'];
type ChildQuestState = Schema['ChildQuestState']['type'];
type ParentProfile = Schema['ParentProfile']['type'];

/**
 * Full, irreversible deletion of every stored record for one child - not
 * the deactivate toggle in ChildProfileList, which keeps the record and
 * lets a parent reactivate it. This is the "deletes" half of
 * docs/TESTING_STRATEGY.md's e2e path 9 ("Parent deletes or deactivates a
 * child profile") and docs/AI_AND_CHILD_SAFETY.md's "data controls and
 * deletion options". Covers every model in amplify/data/resource.ts that
 * carries a `childProfileId`, plus `AdventureAction` (chained through
 * `AdventureSession.sessionId`, since it has no `childProfileId` of its
 * own), then the `ChildProfile` row itself last.
 *
 * Every model added since Phase 8 wrote this function had been missed:
 * `ChildStoryProgress` (Phase 12), `ChildNpcState` (Phase 23),
 * `ChildInventory` (Phase 24), and `ChildQuestState` (Phase 25) all survived
 * a "delete everything" until Phase 25 audited it. Adding a per-child model
 * without adding it here silently breaks the deletion promise in
 * `docs/AI_AND_CHILD_SAFETY.md`, so `deletion.test.ts` now asserts this
 * function touches every model in the schema that carries a
 * `childProfileId` - a new model fails that test until it is handled.
 *
 * The child's uploaded profile photo, if they have one, is deleted from
 * Amplify Storage before the row that points at it - and a failure there
 * aborts the whole deletion rather than being swallowed. "Delete my
 * child's data" has to mean the photograph too, and a parent needs to see
 * an error if it could not be removed, not a success message over a
 * picture of their child still sitting in S3.
 */
export async function deleteChildProfileData(childProfileId: string): Promise<void> {
  const [
    { data: sessions },
    { data: actions },
    { data: skillEvidence },
    { data: skillProgress },
    { data: worldChanges },
    { data: audits },
    { data: safetyEvents },
    { data: storyArtifacts },
    { data: companionProfiles },
    { data: storyProgress },
    { data: npcStates },
    { data: inventories },
    { data: questStates },
  ] = await Promise.all([
    client.models.AdventureSession.list(),
    client.models.AdventureAction.list(),
    client.models.SkillEvidence.list(),
    client.models.SkillProgress.list(),
    client.models.WorldChange.list(),
    client.models.AIInteractionAudit.list(),
    client.models.SafetyEvent.list(),
    client.models.StoryArtifact.list(),
    client.models.CompanionProfile.list(),
    client.models.ChildStoryProgress.list(),
    client.models.ChildNpcState.list(),
    client.models.ChildInventory.list(),
    client.models.ChildQuestState.list(),
  ]);

  const ownSessionIds = new Set(
    sessions
      .filter((session: AdventureSession) => session.childProfileId === childProfileId)
      .map((session: AdventureSession) => session.id),
  );

  await Promise.all([
    ...actions
      .filter((action: AdventureAction) => ownSessionIds.has(action.sessionId))
      .map((action: AdventureAction) => client.models.AdventureAction.delete({ id: action.id })),
    ...skillEvidence
      .filter((row: SkillEvidence) => row.childProfileId === childProfileId)
      .map((row: SkillEvidence) => client.models.SkillEvidence.delete({ id: row.id })),
    ...skillProgress
      .filter((row: SkillProgress) => row.childProfileId === childProfileId)
      .map((row: SkillProgress) => client.models.SkillProgress.delete({ id: row.id })),
    ...worldChanges
      .filter((row: WorldChange) => row.childProfileId === childProfileId)
      .map((row: WorldChange) => client.models.WorldChange.delete({ id: row.id })),
    ...audits
      .filter((row: AIInteractionAudit) => row.childProfileId === childProfileId)
      .map((row: AIInteractionAudit) => client.models.AIInteractionAudit.delete({ id: row.id })),
    ...safetyEvents
      .filter((row: SafetyEvent) => row.childProfileId === childProfileId)
      .map((row: SafetyEvent) => client.models.SafetyEvent.delete({ id: row.id })),
    ...storyArtifacts
      .filter((row: StoryArtifact) => row.childProfileId === childProfileId)
      .map((row: StoryArtifact) => client.models.StoryArtifact.delete({ id: row.id })),
    ...companionProfiles
      .filter((row: CompanionProfile) => row.childProfileId === childProfileId)
      .map((row: CompanionProfile) => client.models.CompanionProfile.delete({ id: row.id })),
    ...storyProgress
      .filter((row: ChildStoryProgress) => row.childProfileId === childProfileId)
      .map((row: ChildStoryProgress) => client.models.ChildStoryProgress.delete({ id: row.id })),
    ...npcStates
      .filter((row: ChildNpcState) => row.childProfileId === childProfileId)
      .map((row: ChildNpcState) => client.models.ChildNpcState.delete({ id: row.id })),
    ...inventories
      .filter((row: ChildInventory) => row.childProfileId === childProfileId)
      .map((row: ChildInventory) => client.models.ChildInventory.delete({ id: row.id })),
    ...questStates
      .filter((row: ChildQuestState) => row.childProfileId === childProfileId)
      .map((row: ChildQuestState) => client.models.ChildQuestState.delete({ id: row.id })),
  ]);

  await Promise.all([...ownSessionIds].map((id) => client.models.AdventureSession.delete({ id })));

  const { data: childProfile } = await client.models.ChildProfile.get({ id: childProfileId });
  if (childProfile?.avatarPhotoKey) {
    await removeChildPhoto(childProfile.avatarPhotoKey);
  }

  const { errors } = await client.models.ChildProfile.delete({ id: childProfileId });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not delete this child profile.');
  }
}

/**
 * Full parent account deletion: every child's data (see
 * `deleteChildProfileData`), the `ParentProfile` record, then the Cognito
 * user itself via `deleteUser()` (which also signs the caller out). Order
 * matters: everything that needs an authenticated session must happen
 * before `deleteUser()` runs.
 */
export async function deleteAccountAndAllData(): Promise<void> {
  const { data: children } = await client.models.ChildProfile.list();
  for (const child of children) {
    await deleteChildProfileData(child.id);
  }

  const { data: parentProfiles } = await client.models.ParentProfile.list();
  await Promise.all(
    parentProfiles.map((parent: ParentProfile) =>
      client.models.ParentProfile.delete({ id: parent.id }),
    ),
  );

  await deleteUser();
}

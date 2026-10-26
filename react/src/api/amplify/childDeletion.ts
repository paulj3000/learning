import { client } from '../../lib/data-client';
import type { Schema } from '../../../../amplify/data/resource';

/**
 * The Amplify half of "delete my child's data" and "delete my account"
 * (`features/child-profile/deletion.ts`, which owns the backend choice, the
 * order of steps and the parent-facing promise). Covers every model in
 * amplify/data/resource.ts that carries a `childProfileId`, plus
 * `AdventureAction` (chained through `AdventureSession.sessionId`), then the
 * `ChildProfile` row itself last. `deletion.test.ts` checks this file
 * against the schema, so a new per-child model fails that test until it is
 * handled here.
 *
 * `removePhoto` deletes the child's stored photo before the row that points
 * at it, and its failure aborts the deletion.
 */

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
type ChildWorldState = Schema['ChildWorldState']['type'];
type ParentProfile = Schema['ParentProfile']['type'];

export async function deleteChildRecords(
  childProfileId: string,
  removePhoto: (path: string) => Promise<void>,
): Promise<void> {
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
    { data: worldStates },
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
    client.models.ChildWorldState.list(),
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
    ...worldStates
      .filter((row: ChildWorldState) => row.childProfileId === childProfileId)
      .map((row: ChildWorldState) => client.models.ChildWorldState.delete({ id: row.id })),
  ]);

  await Promise.all([...ownSessionIds].map((id) => client.models.AdventureSession.delete({ id })));

  const { data: childProfile } = await client.models.ChildProfile.get({ id: childProfileId });
  if (childProfile?.avatarPhotoKey) {
    await removePhoto(childProfile.avatarPhotoKey);
  }

  const { errors } = await client.models.ChildProfile.delete({ id: childProfileId });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not delete this child profile.');
  }
}

/** Ids of the signed-in parent's children (owner-scoped `.list()`). */
export async function listOwnChildIds(): Promise<string[]> {
  const { data: children } = await client.models.ChildProfile.list();
  return children.map((child) => child.id);
}

/** Deletes the signed-in parent's `ParentProfile` record(s). */
export async function deleteOwnParentProfiles(): Promise<void> {
  const { data: parentProfiles } = await client.models.ParentProfile.list();
  await Promise.all(
    parentProfiles.map((parent: ParentProfile) =>
      client.models.ParentProfile.delete({ id: parent.id }),
    ),
  );
}

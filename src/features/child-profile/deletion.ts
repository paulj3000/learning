import { deleteUser } from 'aws-amplify/auth';
import { client } from '../../lib/data-client';
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
  ]);

  await Promise.all([...ownSessionIds].map((id) => client.models.AdventureSession.delete({ id })));

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

import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  deleteUser,
  sessionList,
  actionList,
  skillEvidenceList,
  skillProgressList,
  worldChangeList,
  auditList,
  safetyEventList,
  storyArtifactList,
  companionProfileList,
  childProfileList,
  childProfileGet,
  parentProfileList,
  deleteAdventureSession,
  deleteAdventureAction,
  deleteSkillEvidence,
  deleteSkillProgress,
  deleteWorldChange,
  deleteAudit,
  deleteSafetyEvent,
  deleteStoryArtifact,
  deleteCompanionProfile,
  deleteChildProfile,
  deleteParentProfile,
  storageRemove,
  storyProgressList,
  npcStateList,
  inventoryList,
  questStateList,
  worldStateList,
  deleteStoryProgress,
  deleteNpcState,
  deleteInventory,
  deleteQuestState,
  deleteWorldState,
} = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  sessionList: vi.fn(),
  actionList: vi.fn(),
  skillEvidenceList: vi.fn(),
  skillProgressList: vi.fn(),
  worldChangeList: vi.fn(),
  auditList: vi.fn(),
  safetyEventList: vi.fn(),
  storyArtifactList: vi.fn(),
  companionProfileList: vi.fn(),
  childProfileList: vi.fn(),
  childProfileGet: vi.fn(),
  parentProfileList: vi.fn(),
  deleteAdventureSession: vi.fn(),
  deleteAdventureAction: vi.fn(),
  deleteSkillEvidence: vi.fn(),
  deleteSkillProgress: vi.fn(),
  deleteWorldChange: vi.fn(),
  deleteAudit: vi.fn(),
  deleteSafetyEvent: vi.fn(),
  deleteStoryArtifact: vi.fn(),
  deleteCompanionProfile: vi.fn(),
  deleteChildProfile: vi.fn(),
  deleteParentProfile: vi.fn(),
  storageRemove: vi.fn(),
  storyProgressList: vi.fn(),
  npcStateList: vi.fn(),
  inventoryList: vi.fn(),
  questStateList: vi.fn(),
  worldStateList: vi.fn(),
  deleteStoryProgress: vi.fn(),
  deleteNpcState: vi.fn(),
  deleteInventory: vi.fn(),
  deleteQuestState: vi.fn(),
  deleteWorldState: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({ deleteUser }));

vi.mock('aws-amplify/storage', () => ({
  remove: storageRemove,
  getUrl: vi.fn(),
  uploadData: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      AdventureSession: { list: sessionList, delete: deleteAdventureSession },
      AdventureAction: { list: actionList, delete: deleteAdventureAction },
      SkillEvidence: { list: skillEvidenceList, delete: deleteSkillEvidence },
      SkillProgress: { list: skillProgressList, delete: deleteSkillProgress },
      WorldChange: { list: worldChangeList, delete: deleteWorldChange },
      AIInteractionAudit: { list: auditList, delete: deleteAudit },
      SafetyEvent: { list: safetyEventList, delete: deleteSafetyEvent },
      StoryArtifact: { list: storyArtifactList, delete: deleteStoryArtifact },
      CompanionProfile: { list: companionProfileList, delete: deleteCompanionProfile },
      ChildProfile: { list: childProfileList, get: childProfileGet, delete: deleteChildProfile },
      ParentProfile: { list: parentProfileList, delete: deleteParentProfile },
      ChildStoryProgress: { list: storyProgressList, delete: deleteStoryProgress },
      ChildNpcState: { list: npcStateList, delete: deleteNpcState },
      ChildInventory: { list: inventoryList, delete: deleteInventory },
      ChildQuestState: { list: questStateList, delete: deleteQuestState },
      ChildWorldState: { list: worldStateList, delete: deleteWorldState },
    },
  },
}));

import { deleteAccountAndAllData, deleteChildProfileData } from './deletion';
// Read as text, not imported as modules: this test compares what the schema
// declares against what the deletion function actually calls, which is a
// property of the source rather than of any runtime value.
import schemaSource from '../../../amplify/data/resource.ts?raw';
import deletionSource from './deletion.ts?raw';

describe('deleteChildProfileData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionList.mockResolvedValue({
      data: [
        { id: 'session-own', childProfileId: 'child-1' },
        { id: 'session-other', childProfileId: 'child-2' },
      ],
    });
    actionList.mockResolvedValue({
      data: [
        { id: 'action-own', sessionId: 'session-own' },
        { id: 'action-other', sessionId: 'session-other' },
      ],
    });
    skillEvidenceList.mockResolvedValue({
      data: [
        { id: 'evidence-own', childProfileId: 'child-1' },
        { id: 'evidence-other', childProfileId: 'child-2' },
      ],
    });
    skillProgressList.mockResolvedValue({
      data: [{ id: 'progress-own', childProfileId: 'child-1' }],
    });
    worldChangeList.mockResolvedValue({
      data: [{ id: 'change-own', childProfileId: 'child-1' }],
    });
    auditList.mockResolvedValue({ data: [{ id: 'audit-own', childProfileId: 'child-1' }] });
    safetyEventList.mockResolvedValue({ data: [{ id: 'safety-own', childProfileId: 'child-1' }] });
    storyArtifactList.mockResolvedValue({ data: [{ id: 'story-own', childProfileId: 'child-1' }] });
    companionProfileList.mockResolvedValue({
      data: [{ id: 'companion-own', childProfileId: 'child-1' }],
    });
    childProfileGet.mockResolvedValue({ data: { id: 'child-1', avatarPhotoKey: null } });
    storageRemove.mockResolvedValue(undefined);
    storyProgressList.mockResolvedValue({
      data: [{ id: 'story-progress-own', childProfileId: 'child-1' }],
    });
    npcStateList.mockResolvedValue({ data: [{ id: 'npc-own', childProfileId: 'child-1' }] });
    worldStateList.mockResolvedValue({
      data: [
        { id: 'world-own', childProfileId: 'child-1' },
        { id: 'world-other', childProfileId: 'child-2' },
      ],
    });
    inventoryList.mockResolvedValue({ data: [{ id: 'inventory-own', childProfileId: 'child-1' }] });
    questStateList.mockResolvedValue({
      data: [
        { id: 'quest-own', childProfileId: 'child-1' },
        { id: 'quest-other', childProfileId: 'child-2' },
      ],
    });
    deleteChildProfile.mockResolvedValue({ data: { id: 'child-1' }, errors: undefined });
  });

  it('deletes every record owned by the child, and nothing owned by another child', async () => {
    await deleteChildProfileData('child-1');

    expect(deleteAdventureAction).toHaveBeenCalledWith({ id: 'action-own' });
    expect(deleteAdventureAction).not.toHaveBeenCalledWith({ id: 'action-other' });
    expect(deleteAdventureSession).toHaveBeenCalledWith({ id: 'session-own' });
    expect(deleteAdventureSession).not.toHaveBeenCalledWith({ id: 'session-other' });
    expect(deleteSkillEvidence).toHaveBeenCalledWith({ id: 'evidence-own' });
    expect(deleteSkillEvidence).not.toHaveBeenCalledWith({ id: 'evidence-other' });
    expect(deleteSkillProgress).toHaveBeenCalledWith({ id: 'progress-own' });
    expect(deleteWorldChange).toHaveBeenCalledWith({ id: 'change-own' });
    expect(deleteAudit).toHaveBeenCalledWith({ id: 'audit-own' });
    expect(deleteSafetyEvent).toHaveBeenCalledWith({ id: 'safety-own' });
    expect(deleteStoryArtifact).toHaveBeenCalledWith({ id: 'story-own' });
    expect(deleteCompanionProfile).toHaveBeenCalledWith({ id: 'companion-own' });
    expect(deleteStoryProgress).toHaveBeenCalledWith({ id: 'story-progress-own' });
    expect(deleteNpcState).toHaveBeenCalledWith({ id: 'npc-own' });
    expect(deleteInventory).toHaveBeenCalledWith({ id: 'inventory-own' });
    expect(deleteQuestState).toHaveBeenCalledWith({ id: 'quest-own' });
    expect(deleteQuestState).not.toHaveBeenCalledWith({ id: 'quest-other' });
    expect(deleteWorldState).toHaveBeenCalledWith({ id: 'world-own' });
    expect(deleteWorldState).not.toHaveBeenCalledWith({ id: 'world-other' });
    expect(deleteChildProfile).toHaveBeenCalledWith({ id: 'child-1' });
  });

  /**
   * Four models had been added since this function was written and none was
   * being deleted: story progress (Phase 12), NPC memory (Phase 23),
   * inventory (Phase 24), and quest state (Phase 25). Phase 26's
   * `ChildWorldState` is the first one this test caught before it shipped,
   * which is what it is for. A per-child model that
   * nothing deletes silently breaks the deletion promise in
   * docs/AI_AND_CHILD_SAFETY.md, so this asserts coverage against the schema
   * itself rather than against a list someone has to remember to update.
   */
  it('deletes from every model in the schema that belongs to a child', () => {
    // Every model whose own fields include `childProfileId` - i.e. every
    // model that is a child's data - read from the schema itself rather than
    // from a list someone has to remember to update here.
    const childScopedModels = [
      ...schemaSource.matchAll(/^  (\w+): a\n?\s*\.model\(\{([\s\S]*?)\n    \}\)/gm),
    ]
      .filter(([, , body]) => body.includes('childProfileId: a.id().required()'))
      .map(([, name]) => name);
    const deletedModels = new Set(
      [...deletionSource.matchAll(/client\.models\.(\w+)\.delete/g)].map(([, name]) => name),
    );

    expect(childScopedModels.length).toBeGreaterThan(5);
    for (const model of childScopedModels) {
      expect([...deletedModels], `${model} is never deleted`).toContain(model);
    }
  });

  it('throws when the final ChildProfile delete fails', async () => {
    deleteChildProfile.mockResolvedValue({ data: null, errors: [{ message: 'nope' }] });

    await expect(deleteChildProfileData('child-1')).rejects.toThrow('nope');
  });

  it('deletes an uploaded profile photo before the profile row that points at it', async () => {
    const calls: string[] = [];
    childProfileGet.mockResolvedValue({
      data: { id: 'child-1', avatarPhotoKey: 'child-photos/identity-1/photo.jpg' },
    });
    storageRemove.mockImplementation(async () => {
      calls.push('removePhoto');
    });
    deleteChildProfile.mockImplementation(async (input: { id: string }) => {
      calls.push('deleteChild');
      return { data: { id: input.id }, errors: undefined };
    });

    await deleteChildProfileData('child-1');

    expect(storageRemove).toHaveBeenCalledWith({ path: 'child-photos/identity-1/photo.jpg' });
    expect(calls).toEqual(['removePhoto', 'deleteChild']);
  });

  it('does not delete anything from storage for a child with no photo', async () => {
    await deleteChildProfileData('child-1');

    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('keeps the profile row when its photo could not be deleted', async () => {
    childProfileGet.mockResolvedValue({
      data: { id: 'child-1', avatarPhotoKey: 'child-photos/identity-1/photo.jpg' },
    });
    storageRemove.mockRejectedValue(new Error('network'));

    await expect(deleteChildProfileData('child-1')).rejects.toThrow(/could not delete that photo/i);
    expect(deleteChildProfile).not.toHaveBeenCalled();
  });
});

describe('deleteAccountAndAllData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    childProfileList.mockResolvedValue({ data: [{ id: 'child-1' }] });
    parentProfileList.mockResolvedValue({ data: [{ id: 'parent-1' }] });
    sessionList.mockResolvedValue({ data: [] });
    actionList.mockResolvedValue({ data: [] });
    skillEvidenceList.mockResolvedValue({ data: [] });
    skillProgressList.mockResolvedValue({ data: [] });
    worldChangeList.mockResolvedValue({ data: [] });
    auditList.mockResolvedValue({ data: [] });
    safetyEventList.mockResolvedValue({ data: [] });
    storyArtifactList.mockResolvedValue({ data: [] });
    companionProfileList.mockResolvedValue({ data: [] });
    childProfileGet.mockResolvedValue({ data: { id: 'child-1', avatarPhotoKey: null } });
    storageRemove.mockResolvedValue(undefined);
    storyProgressList.mockResolvedValue({ data: [] });
    npcStateList.mockResolvedValue({ data: [] });
    inventoryList.mockResolvedValue({ data: [] });
    questStateList.mockResolvedValue({ data: [] });
    deleteChildProfile.mockResolvedValue({ data: { id: 'child-1' }, errors: undefined });
    deleteParentProfile.mockResolvedValue({ data: { id: 'parent-1' }, errors: undefined });
  });

  it('deletes every child, the parent profile, and the Cognito user, in that order', async () => {
    const calls: string[] = [];
    deleteChildProfile.mockImplementation(async (input: { id: string }) => {
      calls.push(`deleteChild:${input.id}`);
      return { data: { id: input.id }, errors: undefined };
    });
    deleteParentProfile.mockImplementation(async (input: { id: string }) => {
      calls.push(`deleteParent:${input.id}`);
      return { data: { id: input.id }, errors: undefined };
    });
    deleteUser.mockImplementation(async () => {
      calls.push('deleteUser');
    });

    await deleteAccountAndAllData();

    expect(calls.indexOf('deleteChild:child-1')).toBeLessThan(calls.indexOf('deleteUser'));
    expect(calls.indexOf('deleteParent:parent-1')).toBeLessThan(calls.indexOf('deleteUser'));
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });
});

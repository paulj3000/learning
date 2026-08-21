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
    },
  },
}));

import { deleteAccountAndAllData, deleteChildProfileData } from './deletion';

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
    expect(deleteChildProfile).toHaveBeenCalledWith({ id: 'child-1' });
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

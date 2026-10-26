import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteUser, childProfileList, request } = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  childProfileList: vi.fn(),
  request: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({ deleteUser }));
vi.mock('../../lib/data-client', () => ({
  client: { models: { ChildProfile: { list: childProfileList } } },
}));
vi.mock('../../api/backend', () => ({ djangoClient: () => ({ request }) }));

import { ApiError, ParentFacingError } from '../../api/errors';
import { deleteAccountAndAllData, deleteChildProfileData } from './deletion';

const DJANGO = { backend: 'django', baseUrl: '' } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deletion on a Django build (LAI-0501A)', () => {
  it('asks Django to delete the child and reports its refusal, deleting nothing itself', async () => {
    request.mockRejectedValueOnce(
      new ApiError('forbidden', { status: 403, code: 'sensitive_action_unavailable' }),
    );
    const error = await deleteChildProfileData('child-1', DJANGO).catch((caught: unknown) => caught);

    expect(request).toHaveBeenCalledWith('DELETE', 'children/child-1/');
    expect(error).toBeInstanceOf(ParentFacingError);
    expect((error as ParentFacingError).message).toBe('Deleting profiles is not available yet.');
    expect(childProfileList).not.toHaveBeenCalled();
  });

  it('refuses account deletion before touching Cognito or any data', async () => {
    const error = await deleteAccountAndAllData(DJANGO).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'unsupported', code: 'account_deletion_unavailable' });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(childProfileList).not.toHaveBeenCalled();
  });

  it('treats a misconfigured build like Django: no Amplify deletion', async () => {
    const misconfigured = { backend: 'misconfigured', reason: 'invalid_api_base' } as const;
    await expect(deleteAccountAndAllData(misconfigured)).rejects.toBeInstanceOf(ParentFacingError);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(childProfileList).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('./amplifyProfiles', () => ({ amplifyProfileStore: { source: 'amplify' } }));
vi.mock('../../lib/amplify-config', () => ({ isAmplifyConfigured: false }));

import { profileStoreFor } from './api';

describe('profileStoreFor', () => {
  it('uses Django for every build with the Django API, whatever the sign-in', () => {
    expect(profileStoreFor({ enabled: true, baseUrl: '' }).source).toBe('django');
  });

  it('keeps Amplify only for a build without the Django API (until the cutover)', () => {
    expect(profileStoreFor({ enabled: false }).source).toBe('amplify');
  });
});

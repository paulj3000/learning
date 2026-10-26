import * as amplify from './amplify/companionProfile';
import { selectApi } from './select';

export type { CompanionProfile } from './amplify/companionProfile';

/**
 * The child's chosen companion (Chatty). Django has the `CompanionProfile`
 * model planned (LAI-0307) but no model or route yet, so this is
 * `companionProfile_unavailable` there.
 */
export interface CompanionProfileApi {
  getCompanionProfile: typeof amplify.getCompanionProfile;
  getOrCreateCompanionProfile: typeof amplify.getOrCreateCompanionProfile;
}

export const companionProfileApi: CompanionProfileApi = selectApi<CompanionProfileApi>(
  'companionProfile',
  {
    amplify: {
      getCompanionProfile: amplify.getCompanionProfile,
      getOrCreateCompanionProfile: amplify.getOrCreateCompanionProfile,
    },
  },
);

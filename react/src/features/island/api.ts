/**
 * The child's companion profile, through `react/src/api/companionProfile.ts`
 * (LAI-0501B). Names and signatures are the ones the app already used.
 */
import { companionProfileApi } from '../../api/companionProfile';

export type { CompanionProfile } from '../../api/companionProfile';

export const { getCompanionProfile, getOrCreateCompanionProfile } = companionProfileApi;

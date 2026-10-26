import * as amplify from './amplify/mastery';
import { selectApi } from './select';

export type { SkillProgress } from './amplify/mastery';

/**
 * Per-skill mastery rows (DATA_MODEL.md SkillProgress). On Amplify the
 * client computes and writes them; on Django the server owns mastery
 * (LAI-0603) and has no route for it yet, so both operations are
 * `mastery_unavailable`. Django's `progress.practice` counts are pacing
 * data, explicitly not a mastery level (docs/PLAY_API.md), so they are not
 * mapped onto these rows.
 */
export interface MasteryApi {
  listSkillProgress: typeof amplify.listSkillProgress;
  upsertSkillProgress: typeof amplify.upsertSkillProgress;
}

export const masteryApi: MasteryApi = selectApi<MasteryApi>('mastery', {
  amplify: {
    listSkillProgress: amplify.listSkillProgress,
    upsertSkillProgress: amplify.upsertSkillProgress,
  },
});

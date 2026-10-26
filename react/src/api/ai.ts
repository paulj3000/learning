import * as amplify from './amplify/ai';
import { selectApi } from './select';

export type {
  CompanionGenerationInput,
  InteractionAuditInput,
  SafetyEventInput,
  TutorGenerationInput,
} from './amplify/ai';

/**
 * Constrained AI generation (Chatty, the tutor) and its audit trail. Django
 * has no AI service yet (Phase 7: LAI-0701 to LAI-0703, after the audit
 * models in LAI-0306), so every operation is `ai_unavailable` there. The
 * callers already fall back to authored content on any generation failure
 * and treat audit writes as best effort, so on Django a child always sees
 * the authored line and never an unvalidated one. No new AI route is added.
 */
export interface AiApi {
  generateCompanionTurn: typeof amplify.generateCompanionTurn;
  generateTutorTurn: typeof amplify.generateTutorTurn;
  recordInteractionAudit: typeof amplify.recordInteractionAudit;
  recordSafetyEvent: typeof amplify.recordSafetyEvent;
}

export const aiApi: AiApi = selectApi<AiApi>('ai', {
  amplify: {
    generateCompanionTurn: amplify.generateCompanionTurn,
    generateTutorTurn: amplify.generateTutorTurn,
    recordInteractionAudit: amplify.recordInteractionAudit,
    recordSafetyEvent: amplify.recordSafetyEvent,
  },
});

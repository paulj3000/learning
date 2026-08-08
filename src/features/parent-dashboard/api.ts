import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';

type AIInteractionAudit = Schema['AIInteractionAudit']['type'];
export type SafetyEvent = Schema['SafetyEvent']['type'];

/**
 * Parent-facing safety visibility (docs/AI_AND_CHILD_SAFETY.md "Parent
 * transparency": "safety events requiring attention, using carefully
 * reviewed language"). Read-only - review/dismissal of a `SafetyEvent`
 * remains an admin/reviewer workflow that does not exist yet
 * (docs/AUTHORIZATION_REVIEW.md section 4.3); this only lets a parent see
 * that Chatty replaced an AI response with authored content for their own
 * child, newest first.
 */
export async function listSafetyEvents(childProfileId: string): Promise<SafetyEvent[]> {
  const { data } = await client.models.SafetyEvent.list();
  return data
    .filter((event: SafetyEvent) => event.childProfileId === childProfileId)
    .sort((a: SafetyEvent, b: SafetyEvent) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Parent-controlled retention (docs/ROADMAP.md Phase 7: "controls for AI,
 * voice, session time, and retention"). Permanently deletes every stored
 * `AIInteractionAudit` and `SafetyEvent` row for one child — the metadata
 * `docs/DATA_MODEL.md` says these models keep "by default" — without
 * touching gameplay records (`AdventureSession`/`SkillProgress`/
 * `WorldChange`) or saved stories, which have their own dedicated,
 * per-item retention control (`src/routes/StoryKeepsakes.tsx`).
 */
export async function clearAIHistory(childProfileId: string): Promise<void> {
  const [{ data: audits }, { data: safetyEvents }] = await Promise.all([
    client.models.AIInteractionAudit.list(),
    client.models.SafetyEvent.list(),
  ]);

  const ownAudits = audits.filter(
    (audit: AIInteractionAudit) => audit.childProfileId === childProfileId,
  );
  const ownSafetyEvents = safetyEvents.filter(
    (event: SafetyEvent) => event.childProfileId === childProfileId,
  );

  await Promise.all([
    ...ownAudits.map((audit: AIInteractionAudit) =>
      client.models.AIInteractionAudit.delete({ id: audit.id }),
    ),
    ...ownSafetyEvents.map((event: SafetyEvent) =>
      client.models.SafetyEvent.delete({ id: event.id }),
    ),
  ]);
}

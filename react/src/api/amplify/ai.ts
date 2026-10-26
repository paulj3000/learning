import { client } from '../../lib/data-client';

/**
 * Amplify AI Kit routes and the AI audit trail (CLAUDE.md section 7). Raw
 * transport only: prompt context, schema validation, safety disposition and
 * the authored fallback stay in `features/companion/api.ts` and
 * `features/tutor/api.ts`, which treat any failure here as "use the
 * authored fallback".
 */

export type CompanionGenerationInput = Parameters<
  typeof client.generations.generateCompanionTurn
>[0];
export type TutorGenerationInput = Parameters<typeof client.generations.generateTutorTurn>[0];
export type InteractionAuditInput = Parameters<typeof client.models.AIInteractionAudit.create>[0];
export type SafetyEventInput = Parameters<typeof client.models.SafetyEvent.create>[0];

/** The route's raw output, still unvalidated. Throws when the route answered with no data. */
export async function generateCompanionTurn(input: CompanionGenerationInput): Promise<unknown> {
  const { data, errors } = await client.generations.generateCompanionTurn(input);
  if (errors?.length || !data) {
    throw new Error(errors?.[0]?.message ?? 'The companion route returned no data.');
  }
  return data;
}

/** The route's raw output, still unvalidated. Throws when the route answered with no data. */
export async function generateTutorTurn(input: TutorGenerationInput): Promise<unknown> {
  const { data, errors } = await client.generations.generateTutorTurn(input);
  if (errors?.length || !data) {
    throw new Error(errors?.[0]?.message ?? 'The tutor route returned no data.');
  }
  return data;
}

export async function recordInteractionAudit(input: InteractionAuditInput): Promise<void> {
  await client.models.AIInteractionAudit.create(input);
}

export async function recordSafetyEvent(input: SafetyEventInput): Promise<void> {
  await client.models.SafetyEvent.create(input);
}

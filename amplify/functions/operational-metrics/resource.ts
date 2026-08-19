import { defineFunction } from '@aws-amplify/backend';

/**
 * Turns SafetyEvent/AIInteractionAudit table writes into CloudWatch metrics
 * for the alarms configured in amplify/backend.ts - see handler.ts's doc
 * comment and docs/PILOT_READINESS.md section 3 for why a Lambda is needed
 * here at all (both writes are client-side, so there is no resolver/function
 * log to build a CloudWatch metric filter over otherwise).
 */
export const operationalMetrics = defineFunction({
  name: 'operational-metrics',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
});

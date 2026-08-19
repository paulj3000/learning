import type { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';

/**
 * This function is wired (amplify/backend.ts) to the DynamoDB Streams of
 * both the SafetyEvent and AIInteractionAudit tables (amplify/data/resource.ts).
 * Both writes originate entirely client-side (src/features/companion/api.ts) -
 * there is no server-side hook where a validation failure or safety event
 * could be observed directly - so this stream consumer is the only way to
 * turn "a row got written" into an operational CloudWatch metric an alarm
 * can watch, per docs/PILOT_READINESS.md section 3.
 */

type DynamoDbAttributeImage = Record<string, { S?: string; BOOL?: boolean; N?: string }>;

function stringAttr(image: DynamoDbAttributeImage | undefined, key: string): string | undefined {
  return image?.[key]?.S;
}

function boolAttr(image: DynamoDbAttributeImage | undefined, key: string): boolean | undefined {
  return image?.[key]?.BOOL;
}

function numberAttr(image: DynamoDbAttributeImage | undefined, key: string): number | undefined {
  const raw = image?.[key]?.N;
  return raw === undefined ? undefined : Number(raw);
}

type SafetyEventSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type SafetyDisposition = 'ALLOW' | 'REDIRECT' | 'STOP';

const SAFETY_EVENT_SEVERITIES: readonly SafetyEventSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
const SAFETY_DISPOSITIONS: readonly SafetyDisposition[] = ['ALLOW', 'REDIRECT', 'STOP'];

export type OperationalMetricsSummary = {
  safetyEventsBySeverity: Partial<Record<SafetyEventSeverity, number>>;
  aiInteractionCount: number;
  aiValidationFailureCount: number;
  aiFallbackUsedCount: number;
  aiSafetyDispositionCounts: Partial<Record<SafetyDisposition, number>>;
  aiLatenciesMs: number[];
};

function emptySummary(): OperationalMetricsSummary {
  return {
    safetyEventsBySeverity: {},
    aiInteractionCount: 0,
    aiValidationFailureCount: 0,
    aiFallbackUsedCount: 0,
    aiSafetyDispositionCounts: {},
    aiLatenciesMs: [],
  };
}

/**
 * Distinguishes SafetyEvent from AIInteractionAudit stream records by shape
 * rather than by which event source mapping delivered them, since a single
 * Lambda invocation batch can interleave records from both tables:
 * SafetyEvent has `severity`; AIInteractionAudit has `validationStatus`.
 */
export function summarizeRecords(records: DynamoDBRecord[]): OperationalMetricsSummary {
  const summary = emptySummary();

  for (const record of records) {
    if (record.eventName === 'REMOVE') continue;
    const image = record.dynamodb?.NewImage as DynamoDbAttributeImage | undefined;
    if (!image) continue;

    const severity = stringAttr(image, 'severity');
    if (severity !== undefined && (SAFETY_EVENT_SEVERITIES as string[]).includes(severity)) {
      const key = severity as SafetyEventSeverity;
      summary.safetyEventsBySeverity[key] = (summary.safetyEventsBySeverity[key] ?? 0) + 1;
      continue;
    }

    const validationStatus = stringAttr(image, 'validationStatus');
    if (validationStatus === undefined) continue;

    summary.aiInteractionCount += 1;
    if (validationStatus !== 'VALID') {
      summary.aiValidationFailureCount += 1;
    }
    if (boolAttr(image, 'fallbackUsed')) {
      summary.aiFallbackUsedCount += 1;
    }
    const disposition = stringAttr(image, 'safetyDisposition');
    if (disposition !== undefined && (SAFETY_DISPOSITIONS as string[]).includes(disposition)) {
      const key = disposition as SafetyDisposition;
      summary.aiSafetyDispositionCounts[key] = (summary.aiSafetyDispositionCounts[key] ?? 0) + 1;
    }
    const latencyMs = numberAttr(image, 'latencyMs');
    if (latencyMs !== undefined) {
      summary.aiLatenciesMs.push(latencyMs);
    }
  }

  return summary;
}

type EmfMetricSpec = { name: string; unit: 'Count' | 'Milliseconds'; value: number | number[] };

/**
 * Emits one CloudWatch embedded-metric-format (EMF) log line, which the
 * CloudWatch Logs agent turns into a real custom metric with no
 * `cloudwatch:PutMetricData` IAM permission or AWS SDK dependency required -
 * only the CloudWatch Logs write access every Amplify function already has.
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */
function emitEmf(
  namespace: string,
  dimensions: Record<string, string>,
  metrics: EmfMetricSpec[],
): void {
  if (metrics.length === 0) return;
  const dimensionKeys = Object.keys(dimensions);
  // eslint-disable-next-line no-console -- EMF is a CloudWatch Logs convention: stdout *is* the publish call.
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [dimensionKeys],
            Metrics: metrics.map((metric) => ({ Name: metric.name, Unit: metric.unit })),
          },
        ],
      },
      ...dimensions,
      ...Object.fromEntries(metrics.map((metric) => [metric.name, metric.value])),
    }),
  );
}

export function emitSafetyMetrics(summary: OperationalMetricsSummary): void {
  for (const severity of SAFETY_EVENT_SEVERITIES) {
    const count = summary.safetyEventsBySeverity[severity];
    if (count === undefined) continue;
    emitEmf('LearningAdventureIsland/Safety', { Severity: severity }, [
      { name: 'SafetyEventCount', unit: 'Count', value: count },
    ]);
  }
}

export function emitAiMetrics(summary: OperationalMetricsSummary): void {
  if (summary.aiInteractionCount > 0) {
    const metrics: EmfMetricSpec[] = [
      { name: 'AIInteractionCount', unit: 'Count', value: summary.aiInteractionCount },
      { name: 'AIValidationFailureCount', unit: 'Count', value: summary.aiValidationFailureCount },
      { name: 'AIFallbackUsedCount', unit: 'Count', value: summary.aiFallbackUsedCount },
    ];
    if (summary.aiLatenciesMs.length > 0) {
      metrics.push({ name: 'AILatencyMs', unit: 'Milliseconds', value: summary.aiLatenciesMs });
    }
    emitEmf('LearningAdventureIsland/AI', {}, metrics);
  }

  for (const disposition of SAFETY_DISPOSITIONS) {
    const count = summary.aiSafetyDispositionCounts[disposition];
    if (count === undefined) continue;
    emitEmf('LearningAdventureIsland/AI', { Disposition: disposition }, [
      { name: 'AISafetyDispositionCount', unit: 'Count', value: count },
    ]);
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const summary = summarizeRecords(event.Records);
  emitSafetyMetrics(summary);
  emitAiMetrics(summary);
};

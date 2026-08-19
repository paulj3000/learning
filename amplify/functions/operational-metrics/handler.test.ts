import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBRecord } from 'aws-lambda';
import { emitAiMetrics, emitSafetyMetrics, summarizeRecords } from './handler';

function safetyEventRecord(
  severity: string,
  eventName: DynamoDBRecord['eventName'] = 'INSERT',
): DynamoDBRecord {
  return {
    eventName,
    dynamodb: {
      NewImage: {
        severity: { S: severity },
        category: { S: 'unsafe-topic' },
      },
    },
  };
}

function aiInteractionRecord(options: {
  validationStatus: string;
  fallbackUsed: boolean;
  safetyDisposition?: string;
  latencyMs?: number;
}): DynamoDBRecord {
  return {
    eventName: 'INSERT',
    dynamodb: {
      NewImage: {
        validationStatus: { S: options.validationStatus },
        fallbackUsed: { BOOL: options.fallbackUsed },
        ...(options.safetyDisposition
          ? { safetyDisposition: { S: options.safetyDisposition } }
          : {}),
        ...(options.latencyMs !== undefined ? { latencyMs: { N: String(options.latencyMs) } } : {}),
      },
    },
  };
}

describe('summarizeRecords', () => {
  it('counts SafetyEvent records by severity', () => {
    const summary = summarizeRecords([
      safetyEventRecord('HIGH'),
      safetyEventRecord('HIGH'),
      safetyEventRecord('LOW'),
    ]);
    expect(summary.safetyEventsBySeverity).toEqual({ HIGH: 2, LOW: 1 });
    expect(summary.aiInteractionCount).toBe(0);
  });

  it('counts AIInteractionAudit validation failures, fallbacks, and dispositions', () => {
    const summary = summarizeRecords([
      aiInteractionRecord({
        validationStatus: 'VALID',
        fallbackUsed: false,
        safetyDisposition: 'ALLOW',
        latencyMs: 400,
      }),
      aiInteractionRecord({
        validationStatus: 'INVALID_SCHEMA',
        fallbackUsed: true,
        safetyDisposition: 'ALLOW',
        latencyMs: 900,
      }),
      aiInteractionRecord({
        validationStatus: 'INVALID_CONTENT',
        fallbackUsed: true,
        safetyDisposition: 'STOP',
      }),
    ]);
    expect(summary.aiInteractionCount).toBe(3);
    expect(summary.aiValidationFailureCount).toBe(2);
    expect(summary.aiFallbackUsedCount).toBe(2);
    expect(summary.aiSafetyDispositionCounts).toEqual({ ALLOW: 2, STOP: 1 });
    expect(summary.aiLatenciesMs).toEqual([400, 900]);
  });

  it('ignores REMOVE events and records with no NewImage', () => {
    const summary = summarizeRecords([
      safetyEventRecord('HIGH', 'REMOVE'),
      { eventName: 'INSERT', dynamodb: {} },
    ]);
    expect(summary.safetyEventsBySeverity).toEqual({});
    expect(summary.aiInteractionCount).toBe(0);
  });

  it('ignores an unrecognized severity or validation status value rather than miscounting it', () => {
    const summary = summarizeRecords([
      safetyEventRecord('CRITICAL'),
      aiInteractionRecord({
        validationStatus: 'VALID',
        fallbackUsed: false,
        safetyDisposition: 'UNKNOWN_VALUE',
      }),
    ]);
    expect(summary.safetyEventsBySeverity).toEqual({});
    expect(summary.aiInteractionCount).toBe(1);
    expect(summary.aiSafetyDispositionCounts).toEqual({});
  });
});

describe('emitSafetyMetrics / emitAiMetrics', () => {
  it('emits one EMF log line per observed severity, and none when there are no safety events', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    emitSafetyMetrics({
      safetyEventsBySeverity: { HIGH: 1, LOW: 3 },
      aiInteractionCount: 0,
      aiValidationFailureCount: 0,
      aiFallbackUsedCount: 0,
      aiSafetyDispositionCounts: {},
      aiLatenciesMs: [],
    });
    expect(logSpy).toHaveBeenCalledTimes(2);
    const payloads = logSpy.mock.calls.map(([line]) => JSON.parse(line as string));
    const highPayload = payloads.find((p) => p.Severity === 'HIGH');
    expect(highPayload.SafetyEventCount).toBe(1);
    expect(highPayload._aws.CloudWatchMetrics[0].Namespace).toBe('LearningAdventureIsland/Safety');

    logSpy.mockClear();
    emitSafetyMetrics({
      safetyEventsBySeverity: {},
      aiInteractionCount: 0,
      aiValidationFailureCount: 0,
      aiFallbackUsedCount: 0,
      aiSafetyDispositionCounts: {},
      aiLatenciesMs: [],
    });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('emits AI aggregate metrics including a latency array, and skips the aggregate line when there were no interactions', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    emitAiMetrics({
      safetyEventsBySeverity: {},
      aiInteractionCount: 2,
      aiValidationFailureCount: 1,
      aiFallbackUsedCount: 1,
      aiSafetyDispositionCounts: { ALLOW: 2 },
      aiLatenciesMs: [123, 456],
    });
    const payloads = logSpy.mock.calls.map(([line]) => JSON.parse(line as string));
    const aggregate = payloads.find((p) => p.AIInteractionCount !== undefined);
    expect(aggregate.AIInteractionCount).toBe(2);
    expect(aggregate.AIValidationFailureCount).toBe(1);
    expect(aggregate.AILatencyMs).toEqual([123, 456]);
    const dispositionLine = payloads.find((p) => p.Disposition === 'ALLOW');
    expect(dispositionLine.AISafetyDispositionCount).toBe(2);

    logSpy.mockClear();
    emitAiMetrics({
      safetyEventsBySeverity: {},
      aiInteractionCount: 0,
      aiValidationFailureCount: 0,
      aiFallbackUsedCount: 0,
      aiSafetyDispositionCounts: {},
      aiLatenciesMs: [],
    });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

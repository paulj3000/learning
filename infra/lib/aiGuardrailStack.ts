import { CfnOutput, Duration, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { AssetEnvironment } from './assetStorageStack';

/**
 * The child-safety Guardrail and the Django AI policy (LAI-0704, ADR-044;
 * docs/AI_SERVICE.md). Synthesized only: deploying it is an approval step
 * (ADR-019 gate G7), and nothing in this repository calls Bedrock at deploy.
 *
 * Guardrail, tuned for ages 3 to 8 without blocking ordinary learning talk:
 * - content filters HIGH on input and output for sexual content, violence,
 *   hate, insults and misconduct; prompt-attack HIGH on input (Bedrock does
 *   not apply prompt-attack to output). A pirate story may mention a storm or
 *   a sword; the violence filter acts on harmful depiction, and anything it
 *   still blocks costs the child one calm authored line, never an error.
 * - denied topics: requests for a child's or family's private information,
 *   secrecy from grown-ups, self-harm, and adult topics outside the island.
 * - PII: contact details, addresses, account, identity and payment data are
 *   BLOCKED, never ANONYMIZED (names and ages: see BLOCKED_PII). Django treats every intervention as a
 *   block and runs with the trace off, so a masked reply must never look
 *   like a usable one (lai/apps/ai/providers/bedrock.py).
 * - the AWS-managed profanity word list.
 *
 * Django invokes the model with `bedrock:InvokeModel` on the US inference
 * profile and the destination foundation models only, and needs
 * `bedrock:ApplyGuardrail` on this Guardrail (Converse with
 * `guardrailConfig`). The policy attaches itself to the Django EC2 role
 * (`lai-django-ec2-<env>`, or `djangoRoleArn`), so `LaiDjangoEc2-<env>` is not
 * changed; deploy this stack after it. Region: the stack's own (us-west-1).
 */

/** Haiku 4.5 has no in-Region on-demand id; the US profile is the default. */
export const AI_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
export const AI_INFERENCE_PROFILE_ID = `us.${AI_MODEL_ID}`;
/**
 * Destination Regions of the US profile when called from us-west-1 (Bedrock
 * model card, checked 2026-11-01). Re-check with `aws bedrock
 * get-inference-profile` before deploying (docs/AI_SERVICE.md section 9).
 */
export const US_PROFILE_DESTINATIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'];

export const BLOCKED_INPUT_MESSAGE = "Let's ask a grown-up about that one.";
export const BLOCKED_OUTPUT_MESSAGE = "Let's keep exploring the island together.";

const CONTENT_FILTERS = ['SEXUAL', 'VIOLENCE', 'HATE', 'INSULTS', 'MISCONDUCT'] as const;

/**
 * NAME and AGE are deliberately absent: authored island copy is full of
 * character names ("Captain Pip", "Keeper Quill") and ages of things ("the
 * bee is two weeks old"), and the PII detector would block them. The child's
 * name and age are never sent to the model (lai/apps/ai/services/context.py),
 * and asking for either is covered by the PrivateInformation denied topic and
 * Django's own checks (`requests_personal_information`, the input screen).
 */
export const BLOCKED_PII = [
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'USERNAME',
  'PASSWORD',
  'IP_ADDRESS',
  'URL',
  'LICENSE_PLATE',
  'US_SOCIAL_SECURITY_NUMBER',
  'US_PASSPORT_NUMBER',
  'DRIVER_ID',
  'CREDIT_DEBIT_CARD_NUMBER',
  'CREDIT_DEBIT_CARD_CVV',
  'CREDIT_DEBIT_CARD_EXPIRY',
  'PIN',
  'US_BANK_ACCOUNT_NUMBER',
  'US_BANK_ROUTING_NUMBER',
] as const;

export const DENIED_TOPICS: { name: string; definition: string; examples: string[] }[] = [
  {
    name: 'PrivateInformation',
    definition:
      "Asking for or revealing a child's or family member's real name, address, school, phone number, location, photos, passwords or account details.",
    examples: [
      'What is your home address?',
      'Which school do you go to?',
      'Ask the child for their phone number.',
    ],
  },
  {
    name: 'SecrecyFromGrownUps',
    definition:
      'Encouraging a child to keep secrets from parents or trusted adults, to meet someone, or to move the conversation somewhere else.',
    examples: [
      "This is our secret, don't tell your parents.",
      'Let us talk somewhere your mom cannot see.',
    ],
  },
  {
    name: 'SelfHarmAndDanger',
    definition:
      'Self-harm, suicide, eating disorders, dangerous challenges, weapons use or instructions for risky physical activities.',
    examples: ['How do I hurt myself?', 'Show me how to use a knife to fight.'],
  },
  {
    name: 'AdultTopics',
    definition:
      'Romance, dating, drugs, alcohol, gambling, money transfers, purchases, politics, or medical, legal and emergency advice.',
    examples: ['Can you be my girlfriend?', 'Should I take this medicine?', 'Buy more gems now.'],
  },
];

/** Metric namespace for the Django AI turn metrics (LAI-0708). */
export const AI_METRICS_NAMESPACE = 'LearningAdventureIsland/DjangoAI';

/**
 * The `ai.turn v1` log line (lai/apps/ai/services/auditing.py `emit_metric`), after the
 * privacy formatter's prefix `<date> <time> <level> <logger> [req=<id>]`. Space-delimited and
 * positional: change it only together with `emit_metric`, and bump the version.
 */
export const AI_TURN_FIELDS = [
  'date',
  'time',
  'level',
  'logger',
  'req',
  'event',
  'version',
  'route',
  'source',
  'status',
  'disposition',
  'failure',
  'guardrail',
  'provider',
  'context',
  'latency',
  'inputTokens',
  'outputTokens',
  'costMicroUsd',
  'audit',
] as const;
type TurnField = (typeof AI_TURN_FIELDS)[number];

/** A space-delimited pattern over the turn line; `where` adds conditions to named fields. */
export function turnPattern(where: Partial<Record<TurnField, string>> = {}): string {
  const fixed: Partial<Record<TurnField, string>> = {
    logger: 'logger="lai.ai"',
    event: 'event="ai.turn"',
    version: 'version="v1"',
    ...where,
  };
  return `[${AI_TURN_FIELDS.map((field) => fixed[field] ?? field).join(', ')}]`;
}

/**
 * The `ai.safety v1` line (lai/apps/ai/services/auditing.py `emit_safety_metric`, AMP-05): one
 * per SafetyEvent, closed vocabulary only. It replaces the Amplify `operational-metrics` stream
 * consumer's `SafetyEventCount` by severity. Change it only together with `emit_safety_metric`.
 */
export const AI_SAFETY_FIELDS = [
  'date',
  'time',
  'level',
  'logger',
  'req',
  'event',
  'version',
  'route',
  'severity',
  'source',
  'audit',
] as const;
type SafetyField = (typeof AI_SAFETY_FIELDS)[number];

export function safetyPattern(where: Partial<Record<SafetyField, string>> = {}): string {
  const fixed: Partial<Record<SafetyField, string>> = {
    logger: 'logger="lai.ai"',
    event: 'event="ai.safety"',
    version: 'version="v1"',
    ...where,
  };
  return `[${AI_SAFETY_FIELDS.map((field) => fixed[field] ?? field).join(', ')}]`;
}

export interface AiGuardrailStackProps extends StackProps {
  envName: AssetEnvironment;
  /** The Django workload role, when it is not the EC2 instance role `lai-django-ec2-<env>`. */
  djangoRoleArn?: string;
  /**
   * Alarm thresholds (LAI-0708, AMP-05), sized for the pilot. Every alarm goes to the Django
   * stack's `lai-django-alarms-<env>` topic. None pages on a single event, except a HIGH
   * severity SafetyEvent, as the Amplify `HighSeveritySafetyEventAlarm` did.
   */
  alarms?: Partial<typeof DEFAULT_AI_ALARMS>;
}

export const DEFAULT_AI_ALARMS = {
  /** Provider failures (timeouts, throttling, access denied) in 15 minutes. */
  providerErrorsPer15Min: 10,
  /** Share of turns that fell back, over 30 minutes, once at least `minTurnsForRate` ran. */
  fallbackRate: 0.5,
  minTurnsForRate: 20,
  /** Guardrail interventions in an hour: a spike means probing or a mis-tuned policy. */
  guardrailBlocksPerHour: 25,
  /** Turns in an hour across every family: a request spike. */
  turnsPerHour: 3000,
  /** Average model latency over 15 minutes, in milliseconds. */
  averageLatencyMs: 6000,
  /** Output tokens in a day: unexpected token use. */
  outputTokensPerDay: 2_000_000,
  /** Rate-limited or kill-switched turns in 15 minutes. */
  rateLimitedPer15Min: 100,
  /**
   * Model output that failed schema or content validation in 15 minutes (AMP-05; was the
   * Amplify `AiValidationFailureAlarm`). Every such turn already fell back to authored content.
   */
  validationFailuresPer15Min: 5,
  /** HIGH severity SafetyEvents in 5 minutes (AMP-05; was `HighSeveritySafetyEventAlarm`). */
  highSeveritySafetyEventsPer5Min: 1,
};

export class AiGuardrailStack extends Stack {
  readonly guardrail: bedrock.CfnGuardrail;
  readonly version: bedrock.CfnGuardrailVersion;
  readonly djangoPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: AiGuardrailStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Environment', props.envName);
    Tags.of(this).add('DataClassification', 'child-safety');

    this.guardrail = new bedrock.CfnGuardrail(this, 'ChildSafetyGuardrail', {
      name: `lai-child-safety-${props.envName}`,
      description: 'Learning Adventure Island child-safety guardrail for Chatty (ages 3 to 8)',
      blockedInputMessaging: BLOCKED_INPUT_MESSAGE,
      blockedOutputsMessaging: BLOCKED_OUTPUT_MESSAGE,
      contentPolicyConfig: {
        filtersConfig: [
          ...CONTENT_FILTERS.map((type) => ({
            type,
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
          })),
          { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: DENIED_TOPICS.map((topic) => ({ ...topic, type: 'DENY' })),
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: BLOCKED_PII.map((type) => ({ type, action: 'BLOCK' })),
      },
      wordPolicyConfig: { managedWordListsConfig: [{ type: 'PROFANITY' }] },
    });

    // A published, immutable version. Django refuses DRAFT in production.
    this.version = new bedrock.CfnGuardrailVersion(this, 'ChildSafetyGuardrailVersion', {
      guardrailIdentifier: this.guardrail.attrGuardrailId,
      description: 'Created by LaiAiGuardrail; bump the logical id to publish a new version',
    });

    const partition = Stack.of(this).partition;
    const account = Stack.of(this).account;
    const region = Stack.of(this).region;
    const role = props.djangoRoleArn
      ? iam.Role.fromRoleArn(this, 'DjangoRole', props.djangoRoleArn, { mutable: true })
      : iam.Role.fromRoleName(this, 'DjangoRole', `lai-django-ec2-${props.envName}`);
    this.djangoPolicy = new iam.ManagedPolicy(this, 'DjangoAiPolicy', {
      managedPolicyName: `lai-django-ai-${props.envName}`,
      description:
        'Django AI turns: the US Haiku 4.5 inference profile and the child-safety guardrail',
      statements: [
        new iam.PolicyStatement({
          sid: 'InvokeUsInferenceProfile',
          actions: ['bedrock:InvokeModel'],
          resources: [
            `arn:${partition}:bedrock:${region}:${account}:inference-profile/${AI_INFERENCE_PROFILE_ID}`,
          ],
        }),
        new iam.PolicyStatement({
          sid: 'InvokeProfileDestinationModels',
          actions: ['bedrock:InvokeModel'],
          resources: US_PROFILE_DESTINATIONS.map(
            (destination) =>
              `arn:${partition}:bedrock:${destination}::foundation-model/${AI_MODEL_ID}`,
          ),
          // Only through the profile, never the bare model directly.
          conditions: {
            StringLike: {
              'bedrock:InferenceProfileArn': `arn:${partition}:bedrock:${region}:${account}:inference-profile/${AI_INFERENCE_PROFILE_ID}`,
            },
          },
        }),
        new iam.PolicyStatement({
          sid: 'ApplyChildSafetyGuardrail',
          actions: ['bedrock:ApplyGuardrail'],
          resources: [this.guardrail.attrGuardrailArn],
        }),
      ],
      roles: [role],
    });

    this.addMonitoring(props.envName, { ...DEFAULT_AI_ALARMS, ...props.alarms });

    new CfnOutput(this, 'GuardrailId', {
      value: this.guardrail.attrGuardrailId,
      description: 'SSM /lai/<env>/django/LAI_AI_GUARDRAIL_ID',
    });
    new CfnOutput(this, 'GuardrailVersion', {
      value: this.version.attrVersion,
      description: 'SSM /lai/<env>/django/LAI_AI_GUARDRAIL_VERSION',
    });
    new CfnOutput(this, 'ModelId', {
      value: AI_INFERENCE_PROFILE_ID,
      description: 'SSM /lai/<env>/django/LAI_AI_MODEL_ID',
    });
  }

  /**
   * Metric filters over the Django log group and a few alarms (LAI-0708). Missing data is not
   * breaching: no AI traffic is not an incident.
   */
  private addMonitoring(env: string, thresholds: typeof DEFAULT_AI_ALARMS): void {
    const logGroup = logs.LogGroup.fromLogGroupName(this, 'DjangoLogs', `/lai/${env}/django`);
    const topic = sns.Topic.fromTopicArn(
      this,
      'AlarmTopic',
      `arn:${Stack.of(this).partition}:sns:${Stack.of(this).region}:${Stack.of(this).account}:lai-django-alarms-${env}`,
    );
    const metric = (
      name: string,
      where: Partial<Record<TurnField, string>>,
      value: string,
      statistic: string,
      period: Duration,
    ) => {
      new logs.MetricFilter(this, `${name}Filter`, {
        logGroup,
        filterPattern: logs.FilterPattern.literal(turnPattern(where)),
        metricNamespace: AI_METRICS_NAMESPACE,
        metricName: name,
        metricValue: value,
      });
      return new cloudwatch.Metric({
        namespace: AI_METRICS_NAMESPACE,
        metricName: name,
        statistic,
        period,
      });
    };
    const m15 = Duration.minutes(15);
    const turns = metric('Turns', {}, '1', 'Sum', Duration.minutes(30));
    const fallbacks = metric(
      'Fallbacks',
      { source: 'source="FALLBACK"' },
      '1',
      'Sum',
      Duration.minutes(30),
    );
    metric('Generations', { source: 'source="AI"' }, '1', 'Sum', m15);
    const providerErrors = metric('ProviderErrors', { status: 'status="ERROR"' }, '1', 'Sum', m15);
    const guardrailBlocks = metric(
      'GuardrailBlocks',
      { status: 'status="BLOCKED_GUARDRAIL"' },
      '1',
      'Sum',
      Duration.hours(1),
    );
    const rateLimited = metric('RateLimited', { status: 'status="RATE_LIMITED"' }, '1', 'Sum', m15);
    const latency = metric(
      'LatencyMs',
      { provider: 'provider="bedrock"' },
      '$latency',
      'Average',
      m15,
    );
    metric('InputTokens', {}, '$inputTokens', 'Sum', Duration.hours(1));
    const outputTokens = metric('OutputTokens', {}, '$outputTokens', 'Sum', Duration.days(1));
    metric('EstimatedCostMicroUsd', {}, '$costMicroUsd', 'Sum', Duration.days(1));
    const validationFailures = metric(
      'ValidationFailures',
      { status: 'status="INVALID*"' },
      '1',
      'Sum',
      m15,
    );
    // SafetyEvents (AMP-05): the Django side of the Amplify SafetyEventCount by severity.
    const safetyMetric = (
      name: string,
      where: Partial<Record<SafetyField, string>>,
      period: Duration,
    ) => {
      new logs.MetricFilter(this, `${name}Filter`, {
        logGroup,
        filterPattern: logs.FilterPattern.literal(safetyPattern(where)),
        metricNamespace: AI_METRICS_NAMESPACE,
        metricName: name,
        metricValue: '1',
      });
      return new cloudwatch.Metric({
        namespace: AI_METRICS_NAMESPACE,
        metricName: name,
        statistic: 'Sum',
        period,
      });
    };
    safetyMetric('SafetyEvents', {}, Duration.hours(1));
    const highSeverity = safetyMetric(
      'HighSeveritySafetyEvents',
      { severity: 'severity="HIGH"' },
      Duration.minutes(5),
    );

    const notify = new cwActions.SnsAction(topic);
    const gte = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    const alarm = (id: string, description: string, m: cloudwatch.IMetric, threshold: number) => {
      const created = new cloudwatch.Alarm(this, id, {
        alarmName: `lai-django-ai-${env}-${id.replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase())}`,
        alarmDescription: description,
        metric: m,
        threshold,
        comparisonOperator: gte,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      created.addAlarmAction(notify);
      created.addOkAction(notify);
    };
    alarm(
      'ProviderErrors',
      'Django AI: Bedrock calls are failing (timeouts, throttling, access)',
      providerErrors,
      thresholds.providerErrorsPer15Min,
    );
    alarm(
      'FallbackRate',
      'Django AI: most turns are falling back to authored content',
      new cloudwatch.MathExpression({
        expression: `IF(turns >= ${thresholds.minTurnsForRate}, fallbacks / turns, 0)`,
        usingMetrics: { turns, fallbacks },
        period: Duration.minutes(30),
      }),
      thresholds.fallbackRate,
    );
    alarm(
      'GuardrailBlocks',
      'Django AI: unusual number of Guardrail interventions',
      guardrailBlocks,
      thresholds.guardrailBlocksPerHour,
    );
    alarm(
      'TurnSpike',
      'Django AI: request spike across all families',
      new cloudwatch.Metric({
        namespace: AI_METRICS_NAMESPACE,
        metricName: 'Turns',
        statistic: 'Sum',
        period: Duration.hours(1),
      }),
      thresholds.turnsPerHour,
    );
    alarm(
      'Latency',
      'Django AI: average Bedrock latency is high',
      latency,
      thresholds.averageLatencyMs,
    );
    alarm(
      'OutputTokens',
      'Django AI: unexpected output token use today',
      outputTokens,
      thresholds.outputTokensPerDay,
    );
    alarm(
      'RateLimited',
      'Django AI: many turns are being rate limited or kill-switched',
      rateLimited,
      thresholds.rateLimitedPer15Min,
    );
    alarm(
      'ValidationFailures',
      'Django AI: model output is failing validation (a Bedrock behaviour change or a prompt or ' +
        'schema regression); every failed turn already fell back to authored content',
      validationFailures,
      thresholds.validationFailuresPer15Min,
    );
    alarm(
      'HighSeveritySafetyEvent',
      'Django AI: a HIGH severity SafetyEvent was recorded; review it in Django Admin now ' +
        '(docs/AI_AND_CHILD_SAFETY.md human review)',
      highSeverity,
      thresholds.highSeveritySafetyEventsPer5Min,
    );
  }
}

import { defineBackend } from '@aws-amplify/backend';
import { Duration, Stack } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { type ITable, StreamViewType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, ServicePrincipal, type Role } from 'aws-cdk-lib/aws-iam';
import {
  Code,
  Function as CdkLambdaFunction,
  Runtime,
  StartingPosition,
  type Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Trigger } from 'aws-cdk-lib/triggers';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { operationalMetrics } from './functions/operational-metrics/resource';
import { claimCoopSlot } from './functions/claim-coop-slot/resource';

/**
 * Phase 1-4: parent auth, the application data model, and the
 * `generateCompanionTurn` AI generation route (amplify/data/resource.ts).
 * Phase 8 adds `operationalMetrics` (see the monitoring section at the
 * bottom of this file) — the first Lambda function in this backend.
 * `storage` (amplify/storage/resource.ts) holds one thing: the optional
 * child profile photo a parent may upload as their child's icon. Its
 * access rules are identity-scoped to the uploading parent and are
 * documented in full at that resource.
 * @see https://docs.amplify.aws/react/build-a-backend/
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  operationalMetrics,
  claimCoopSlot,
});

/**
 * Amplify AI Kit's generated IAM policy for a `@generation` route only
 * ever grants `bedrock:InvokeModel` on a single
 * `foundation-model/<modelId>` ARN
 * (@aws-amplify/graphql-generation-transformer's
 * `createBedrockDataSourceRole`) — it has no special handling for
 * `global.`-prefixed model IDs, which are actually Bedrock "Global
 * cross-Region inference profiles", a *different* IAM resource type.
 * Invoking one requires permission on three separate resource ARNs: the
 * inference-profile ARN itself (regional, account-scoped), a region-scoped
 * foundation-model ARN (no account — foundation models are AWS-owned), and
 * an unscoped (no region/account) foundation-model ARN, since the request
 * can be routed to any commercial AWS Region
 * (docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html).
 * Without this, `generateCompanionTurn` fails with `AccessDeniedException`
 * regardless of Bedrock model access or AWS Marketplace subscription
 * state — confirmed live; see the open upstream issue
 * https://github.com/aws-amplify/docs/issues/8121 ("AI kit does not
 * support Cross-region inference"). `Claude Haiku 4.5` only exists on
 * Bedrock as a Global inference profile (no direct in-Region option), so
 * this patch is required for `generateCompanionTurn` to work at all.
 *
 * The nested stack name (`GenerationBedrockDataSource<FieldName>Stack`)
 * and the role's construct id
 * (`GenerationBedrockDataSource<FieldName>IAMRole`) are deterministic,
 * generated from the schema's route field name
 * (`bedrockDataSourceName`/`createBedrockDataSourceRole` in the same
 * transformer package) — not a hash-suffixed logical ID — so this stays
 * stable across redeploys as long as the route stays named
 * `generateCompanionTurn`.
 */
const generationStack =
  backend.data.resources.nestedStacks['GenerationBedrockDataSourceGenerateCompanionTurnStack'];
const generationRole = generationStack?.node.findChild(
  'GenerationBedrockDataSourceGenerateCompanionTurnIAMRole',
) as Role | undefined;

if (!generationRole) {
  throw new Error(
    'Could not find the generateCompanionTurn Bedrock IAM role to patch cross-Region ' +
      'inference permissions onto. Amplify AI Kit may have changed its internal construct ' +
      'naming; see the comment above this code for what changed.',
  );
}

const bedrockModelId = 'anthropic.claude-haiku-4-5-20251001-v1:0';
const stack = Stack.of(generationRole);
generationRole.addToPrincipalPolicy(
  new PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/global.${bedrockModelId}`,
      `arn:${stack.partition}:bedrock:${stack.region}::foundation-model/${bedrockModelId}`,
      `arn:${stack.partition}:bedrock:::foundation-model/${bedrockModelId}`,
    ],
  }),
);

/**
 * Phase 8 — Operational dashboards and alarms (docs/ROADMAP.md,
 * docs/PILOT_READINESS.md section 3).
 *
 * `AIInteractionAudit` and `SafetyEvent` (amplify/data/resource.ts) are
 * both written directly by the browser via the Amplify Data client
 * (src/features/companion/api.ts) — there is no Lambda or resolver in the
 * write path to attach a CloudWatch metric filter to. `operationalMetrics`
 * (amplify/functions/operational-metrics/) is a DynamoDB Streams consumer
 * on both tables that turns each write into a CloudWatch embedded-metric
 * (EMF) log line, which is the only way to get a real alarm on "a HIGH
 * severity SafetyEvent was written" or "generateCompanionTurn validation
 * failures spiked" given that constraint.
 *
 * Every alarm below notifies `operationalAlertsTopic`. Subscribe the pilot
 * operator's email by setting the `PILOT_ALERT_EMAIL` environment variable
 * before deploying (`ampx sandbox` / `ampx pipeline-deploy`) — with no
 * subscriber the topic and alarms still deploy, they just have no one to
 * notify yet, which is safe but not useful; see docs/PILOT_READINESS.md
 * section 4's pilot-readiness checklist.
 *
 * This code has been typechecked and read carefully against the installed
 * `aws-cdk-lib`/`@aws-amplify/*` type definitions, but has NOT been
 * deployed or exercised against live AWS in this environment (no AWS
 * credentials were available in this session — see
 * docs/PILOT_READINESS.md's opening paragraph for why that's a recurring
 * constraint here). Confirm the dashboard renders and each alarm actually
 * fires end-to-end the first time this deploys to a real sandbox.
 */
const monitoringStack = backend.createStack('OperationalMonitoring');

const operationalAlertsTopic = new Topic(monitoringStack, 'OperationalAlertsTopic', {
  displayName: 'Learning Adventure Island operational alerts',
});
const pilotAlertEmail = process.env.PILOT_ALERT_EMAIL;
if (pilotAlertEmail) {
  operationalAlertsTopic.addSubscription(new EmailSubscription(pilotAlertEmail));
}
// AWS Budgets can only notify an SNS topic that explicitly trusts it.
operationalAlertsTopic.addToResourcePolicy(
  new PolicyStatement({
    actions: ['sns:Publish'],
    principals: [new ServicePrincipal('budgets.amazonaws.com')],
    resources: [operationalAlertsTopic.topicArn],
  }),
);
const alertAction = new SnsAction(operationalAlertsTopic);

/**
 * Enables a DynamoDB stream on one of this backend's generated model
 * tables. Model tables are exposed keyed by plain model name
 * (`backend.data.resources.tables['SafetyEvent']`, matching
 * @aws-amplify/graphql-api-construct's own documented example), so this
 * looks the table up by that exact key and fails loudly at synth time if
 * Amplify ever changes that convention, rather than silently wiring
 * nothing.
 */
function enableModelTableStream(modelName: string): ITable {
  const streamConfig = backend.data.resources.cfnResources.amplifyDynamoDbTables[modelName];
  const table = backend.data.resources.tables[modelName];
  if (!streamConfig || !table) {
    throw new Error(
      `Could not find the "${modelName}" model's generated DynamoDB table to enable a stream on. ` +
        'Amplify Data may have changed its table lookup key (expected the plain model name); ' +
        'see the comment above enableModelTableStream in amplify/backend.ts.',
    );
  }
  streamConfig.streamSpecification = { streamViewType: StreamViewType.NEW_IMAGE };
  return table;
}
const safetyEventTable = enableModelTableStream('SafetyEvent');
const aiInteractionAuditTable = enableModelTableStream('AIInteractionAudit');

/**
 * Enabling a DynamoDB Stream on an existing model table
 * (`enableModelTableStream` above) is asynchronous on AWS's side:
 * CloudFormation reports the table `UPDATE_COMPLETE` once `UpdateTable`
 * has been accepted and the table is `ACTIVE` again, but the stream itself
 * sits in `ENABLING` for a few seconds after that before DynamoDB reports
 * it `ENABLED`, and Lambda refuses to create an event source mapping on a
 * stream that is not enabled yet.
 *
 * This `Trigger` forces a wait between the two: it only runs after both
 * tables' stream-enabling updates complete (`executeAfter`), and nothing
 * that reads or consumes a stream ARN below is created until it succeeds
 * (`executeBefore`). 90 seconds is a generous margin over the few seconds
 * AWS documents for stream activation — DynamoDB exposes no "wait until
 * this stream is enabled" API to poll precisely instead.
 */
const streamActivationDelay = new CdkLambdaFunction(
  monitoringStack,
  'DynamoStreamActivationDelay',
  {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline(
      'exports.handler = async () => { await new Promise((resolve) => setTimeout(resolve, 90_000)); };',
    ),
    timeout: Duration.minutes(3),
  },
);
const streamActivationTrigger = new Trigger(monitoringStack, 'DynamoStreamActivationTrigger', {
  handler: streamActivationDelay,
  timeout: Duration.minutes(3),
  executeAfter: [safetyEventTable, aiInteractionAuditTable],
});

/**
 * Reads back the ARN of the stream that is actually live on one model
 * table, at deploy time, after `streamActivationTrigger` has run.
 *
 * The obvious `table.tableStreamArn` — the `TableStreamArn` attribute of
 * Amplify's `Custom::AmplifyDynamoDBTable` resource — is wrong on exactly
 * the deploy that turns a stream on. Amplify's table-manager Lambda
 * describes the table *before* it issues the stream `UpdateTable`, then
 * returns that pre-update describe's `LatestStreamArn` as the attribute
 * (the `Update` branch of `amplify-table-manager-handler` in
 * @aws-amplify/graphql-model-transformer), so on a stream-enabling deploy
 * the attribute holds either nothing or the ARN of an older stream. That,
 * not the activation delay above, is what failed this phase's last deploy:
 * both event source mappings were created against a
 * `.../stream/2026-08-19T20:19:01.702` ARN — a stream an earlier
 * rolled-back deploy had created and its rollback had disabled — and
 * Lambda rejected them with "Stream ... is Disabled".
 *
 * Amplify Hosting's `AWS_JOB_ID` is folded into the physical resource id so
 * this lookup re-runs on every CI deploy. CloudFormation only re-invokes a
 * custom resource whose properties changed, and a cached ARN here would be
 * silently wrong (metrics stop, no alarm fires) the moment a failed deploy
 * and its rollback disable a stream and a later deploy re-enables it under
 * a new ARN.
 */
function liveStreamArn(modelName: string, table: ITable): string {
  const lookup = new AwsCustomResource(monitoringStack, `${modelName}LiveStreamArn`, {
    onUpdate: {
      service: 'DynamoDB',
      action: 'describeTable',
      parameters: { TableName: table.tableName },
      // CloudFormation caps a custom resource's response at 4KB, and a full
      // `DescribeTable` payload (every attribute definition, GSI, and index
      // status) can approach that; only one field is needed here.
      outputPaths: ['Table.LatestStreamArn'],
      physicalResourceId: PhysicalResourceId.of(
        `${modelName}-stream-${process.env.AWS_JOB_ID ?? 'sandbox'}`,
      ),
    },
    policy: AwsCustomResourcePolicy.fromStatements([
      new PolicyStatement({ actions: ['dynamodb:DescribeTable'], resources: [table.tableArn] }),
    ]),
    installLatestAwsSdk: false,
  });
  streamActivationTrigger.executeBefore(lookup);
  return lookup.getResponseField('Table.LatestStreamArn');
}

/** Wires `operationalMetrics` to consume one model table's now-enabled stream. */
function wireModelTableEventSource(modelName: string, table: ITable): void {
  const lambda = backend.operationalMetrics.resources.lambda;
  lambda.addEventSourceMapping(`${modelName}StreamEventSource`, {
    eventSourceArn: liveStreamArn(modelName, table),
    startingPosition: StartingPosition.LATEST,
    retryAttempts: 2,
    reportBatchItemFailures: false,
  });
  // `DynamoEventSource` would normally grant the consumer stream read access
  // for us, but it derives that grant from the same stale `TableStreamArn`
  // attribute described above, which would leave the function unable to read
  // the stream it is mapped to. Grant on every stream this table can ever
  // have instead — stream ARNs are the table ARN plus a creation timestamp,
  // so this stays correct across the table's streams being re-enabled.
  lambda.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:ListStreams',
      ],
      resources: [`${table.tableArn}/stream/*`],
    }),
  );
}
wireModelTableEventSource('SafetyEvent', safetyEventTable);
wireModelTableEventSource('AIInteractionAudit', aiInteractionAuditTable);

// --- AppSync 4xx/5xx error-rate alarms ---
// AWS/AppSync's built-in metrics, not a custom one — read directly off
// `graphqlApi.apiId` since `IGraphqlApi` doesn't expose `.metric4XXError()`
// helpers itself (those exist only on the concrete `GraphqlApi` class).
const graphqlApiId = backend.data.resources.graphqlApi.apiId;
function appSyncMetric(metricName: '4XXError' | '5XXError'): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: 'AWS/AppSync',
    metricName,
    dimensionsMap: { GraphQLAPIId: graphqlApiId },
    statistic: 'Sum',
    period: Duration.minutes(15),
  });
}
new cloudwatch.Alarm(monitoringStack, 'AppSync5xxErrorAlarm', {
  metric: appSyncMetric('5XXError'),
  threshold: 5,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  alarmDescription: 'AppSync returned 5+ server errors in 15 minutes.',
}).addAlarmAction(alertAction);
new cloudwatch.Alarm(monitoringStack, 'AppSync4xxErrorAlarm', {
  metric: appSyncMetric('4XXError'),
  threshold: 20,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  alarmDescription:
    'AppSync returned 20+ client errors in 15 minutes — may indicate an auth regression or a bad client release.',
}).addAlarmAction(alertAction);

// --- Custom metric alarms, fed by operationalMetrics' EMF log lines ---
const aiValidationFailureMetric = new cloudwatch.Metric({
  namespace: 'LearningAdventureIsland/AI',
  metricName: 'AIValidationFailureCount',
  statistic: 'Sum',
  period: Duration.minutes(15),
});
new cloudwatch.Alarm(monitoringStack, 'AiValidationFailureAlarm', {
  metric: aiValidationFailureMetric,
  threshold: 5,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  alarmDescription:
    'generateCompanionTurn validation failures spiked in 15 minutes — likely a Bedrock behavior change or a ' +
    'prompt/schema regression (docs/PILOT_READINESS.md section 2), not a safety issue by itself since every ' +
    'invalid response already falls back to authored content.',
}).addAlarmAction(alertAction);

const highSeveritySafetyEventMetric = new cloudwatch.Metric({
  namespace: 'LearningAdventureIsland/Safety',
  metricName: 'SafetyEventCount',
  dimensionsMap: { Severity: 'HIGH' },
  statistic: 'Sum',
  period: Duration.minutes(5),
});
new cloudwatch.Alarm(monitoringStack, 'HighSeveritySafetyEventAlarm', {
  metric: highSeveritySafetyEventMetric,
  threshold: 1,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  alarmDescription:
    'A HIGH severity SafetyEvent was recorded — the single most safety-relevant signal this system produces ' +
    "(docs/PILOT_READINESS.md section 3); review docs/AI_AND_CHILD_SAFETY.md's human-review workflow now.",
}).addAlarmAction(alertAction);

// --- Bedrock cost/budget alarm ---
// The most important alarm to have before, not after, a pilot begins
// (docs/THREAT_MODEL.md's open "Bedrock cost/quota exhaustion" risk).
// Override the default via PILOT_MONTHLY_BEDROCK_BUDGET_USD before deploying.
const monthlyBedrockBudgetUsd = Number(process.env.PILOT_MONTHLY_BEDROCK_BUDGET_USD ?? '50');
new budgets.CfnBudget(monitoringStack, 'BedrockMonthlyCostBudget', {
  budget: {
    budgetType: 'COST',
    timeUnit: 'MONTHLY',
    budgetLimit: { amount: monthlyBedrockBudgetUsd, unit: 'USD' },
    costFilters: { Service: ['Amazon Bedrock'] },
  },
  notificationsWithSubscribers: [
    {
      notification: {
        notificationType: 'ACTUAL',
        comparisonOperator: 'GREATER_THAN',
        threshold: 80,
        thresholdType: 'PERCENTAGE',
      },
      subscribers: [{ subscriptionType: 'SNS', address: operationalAlertsTopic.topicArn }],
    },
    {
      notification: {
        notificationType: 'FORECASTED',
        comparisonOperator: 'GREATER_THAN',
        threshold: 100,
        thresholdType: 'PERCENTAGE',
      },
      subscribers: [{ subscriptionType: 'SNS', address: operationalAlertsTopic.topicArn }],
    },
  ],
});

// --- Dashboard ---
// One place for the metrics docs/ARCHITECTURE.md's Observability section
// already commits to tracking: AI route latency, validation-failure rate,
// fallback rate, safety-disposition breakdown, and SafetyEvent volume by
// severity.
const aiInteractionCountMetric = new cloudwatch.Metric({
  namespace: 'LearningAdventureIsland/AI',
  metricName: 'AIInteractionCount',
  statistic: 'Sum',
  period: Duration.minutes(15),
});
const aiFallbackUsedMetric = new cloudwatch.Metric({
  namespace: 'LearningAdventureIsland/AI',
  metricName: 'AIFallbackUsedCount',
  statistic: 'Sum',
  period: Duration.minutes(15),
});
const aiLatencyMetric = new cloudwatch.Metric({
  namespace: 'LearningAdventureIsland/AI',
  metricName: 'AILatencyMs',
  statistic: 'p90',
  period: Duration.minutes(15),
});
const safetyEventMetricFor = (severity: 'LOW' | 'MEDIUM' | 'HIGH') =>
  new cloudwatch.Metric({
    namespace: 'LearningAdventureIsland/Safety',
    metricName: 'SafetyEventCount',
    dimensionsMap: { Severity: severity },
    statistic: 'Sum',
    period: Duration.hours(1),
  });

new cloudwatch.Dashboard(monitoringStack, 'OperationalDashboard', {
  dashboardName: 'learning-adventure-island-operations',
  widgets: [
    [
      new cloudwatch.GraphWidget({
        title: 'AppSync errors (15m sum)',
        left: [appSyncMetric('4XXError'), appSyncMetric('5XXError')],
      }),
      new cloudwatch.GraphWidget({
        title: 'AI interaction volume (15m sum)',
        left: [aiInteractionCountMetric, aiValidationFailureMetric, aiFallbackUsedMetric],
      }),
    ],
    [
      new cloudwatch.GraphWidget({
        title: 'AI response latency, p90 (ms)',
        left: [aiLatencyMetric],
      }),
      new cloudwatch.GraphWidget({
        title: 'SafetyEvent volume by severity (1h sum)',
        left: [
          safetyEventMetricFor('LOW'),
          safetyEventMetricFor('MEDIUM'),
          safetyEventMetricFor('HIGH'),
        ],
      }),
    ],
  ],
});

/**
 * Phase 17 — Household Co-Presence (docs/DECISIONS.md ADR-006).
 * `claimCoopSlot`'s Lambda talks to the `CoopSession` table directly via
 * the AWS SDK (amplify/functions/claim-coop-slot/handler.ts) rather than
 * through an AppSync resolver, specifically so it can issue a conditional
 * `UpdateItem` for atomic first-write-wins slot claims — something the
 * generated `CoopSession.update()` mutation cannot do. That means it needs
 * its own read/write grant on the table and its own way to find the table
 * name, since it never goes through `backend.data`'s resolvers at request
 * time.
 */
const coopSessionTable = backend.data.resources.tables['CoopSession'];
if (!coopSessionTable) {
  throw new Error(
    'Could not find the generated CoopSession table to grant claimCoopSlot access to. ' +
      'Amplify Data may have changed its table lookup key; see wireModelTableStream above for the same pattern.',
  );
}
coopSessionTable.grantReadWriteData(backend.claimCoopSlot.resources.lambda);
// `.resources.lambda` is typed as the generic CDK `IFunction` interface,
// which has no `addEnvironment` — only the concrete `Function` class does.
// Every Amplify-defined function is backed by a concrete `NodejsFunction`
// (itself a `Function` subclass), same assumption `wireModelTableStream`
// above already relies on for its own typed CDK access.
(backend.claimCoopSlot.resources.lambda as LambdaFunction).addEnvironment(
  'COOP_SESSION_TABLE_NAME',
  coopSessionTable.tableName,
);

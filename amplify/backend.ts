import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement, type Role } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * Phase 1-4: parent auth, the application data model, and the
 * `generateCompanionTurn` AI generation route (amplify/data/resource.ts).
 * Storage and functions are added in later roadmap phases per docs/ROADMAP.md.
 * @see https://docs.amplify.aws/react/build-a-backend/
 */
const backend = defineBackend({
  auth,
  data,
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

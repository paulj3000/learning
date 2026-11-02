import { CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
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

export interface AiGuardrailStackProps extends StackProps {
  envName: AssetEnvironment;
  /** The Django workload role, when it is not the EC2 instance role `lai-django-ec2-<env>`. */
  djangoRoleArn?: string;
}

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
}

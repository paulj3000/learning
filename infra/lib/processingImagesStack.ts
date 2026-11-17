import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { AssetEnvironment } from './assetStorageStack';
import { githubOidcProviderArn, githubPrincipal, isGithubRepository } from './githubOidc';

/**
 * Phase 1 of the processing worker (LAI-LAMBDA-005, ADR-061, docs/processing/WAVE2_INTERFACES.md
 * section 7): `LaiProcessingImages-<env>` holds the worker's container image repository and the
 * role GitHub Actions assumes to push to it. Nothing else: the queues, bucket and function are in
 * `LaiProcessing-<env>` (infra/lib/processingStack.ts), which references an image in this
 * repository by immutable digest.
 *
 * The image is built off-host (GitHub Actions, linux/arm64, `processing/Dockerfile.lambda`), never
 * on an EC2 instance. The repository is per environment, so a dev push can never become a prod
 * image except through a deliberate copy or rebuild in the prod environment.
 *
 * The publisher role trusts the account's existing GitHub OIDC provider by ARN (created by
 * `LaiDevPlatform-dev` or `LaiDjangoRelease`); this stack never creates a second provider. It
 * trusts exactly one GitHub environment, `processing-<env>`, whose required reviewers the owner
 * configures, and can push to this repository and nothing else: no deploy, no other repository,
 * no secrets.
 *
 * Bootstrapless (no assets, no custom resources). Deploying it is an owner-approved step.
 */

export function processingRepositoryName(envName: AssetEnvironment): string {
  return `lai/processing-${envName}`;
}

export function processingPublisherRoleName(envName: AssetEnvironment): string {
  return `lai-github-processing-publisher-${envName}`;
}

/** The function name the repository policy lets Lambda pull for (processingStack.ts). */
export function processingWorkerName(envName: AssetEnvironment): string {
  return `lai-${envName}-processing-worker`;
}

/** Tagged images kept; a rollback digest must be one of these (docs/infrastructure/processing-infrastructure.md). */
export const KEPT_PROCESSING_IMAGES = 30;

export interface ProcessingImagesStackProps extends StackProps {
  envName: AssetEnvironment;
  /** `owner/repo` of the GitHub repository allowed to push images. */
  githubRepository: string;
  /** Tagged images to keep (default {@link KEPT_PROCESSING_IMAGES}). */
  keptImages?: number;
}

export class ProcessingImagesStack extends Stack {
  readonly repository: ecr.Repository;
  readonly publisherRole: iam.Role;

  constructor(scope: Construct, id: string, props: ProcessingImagesStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    if (!isGithubRepository(props.githubRepository)) {
      throw new Error(`githubRepository must be owner/repo, got "${props.githubRepository}"`);
    }
    const kept = props.keptImages ?? KEPT_PROCESSING_IMAGES;
    if (!Number.isInteger(kept) || kept < 5 || kept > 1000) {
      throw new Error(`keptImages must be an integer from 5 to 1000, got ${kept}`);
    }
    const env = props.envName;
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'processing-images');
    Tags.of(this).add('Environment', env);

    this.repository = new ecr.Repository(this, 'ProcessingRepository', {
      repositoryName: processingRepositoryName(env),
      // A tag (the full commit SHA) never moves; the function is pinned by digest anyway.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.AES_256,
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Untagged images and failed pushes',
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(7),
        },
        {
          rulePriority: 2,
          description: `Keep the newest ${kept} worker images (rollback targets)`,
          tagStatus: ecr.TagStatus.ANY,
          maxImageCount: kept,
        },
      ],
      // The image of a running function must outlive the stack.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // Lambda pulls the image with its service principal; same account, this function only.
    this.repository.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'LambdaPullForTheWorker',
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
        conditions: {
          StringLike: {
            'aws:sourceArn': `arn:${Aws.PARTITION}:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:${processingWorkerName(env)}`,
          },
        },
      }),
    );

    this.publisherRole = new iam.Role(this, 'ImagePublisherRole', {
      roleName: processingPublisherRoleName(env),
      description: `GitHub Actions environment processing-${env} on ${props.githubRepository}: push worker images`,
      assumedBy: githubPrincipal(
        githubOidcProviderArn(),
        `repo:${props.githubRepository}:environment:processing-${env}`,
      ),
      maxSessionDuration: Duration.hours(1),
    });
    this.publisherRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrLogin',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'], // the action has no resource-level permissions
      }),
    );
    this.publisherRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PushWorkerImages',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:CompleteLayerUpload',
          'ecr:DescribeImageScanFindings',
          'ecr:DescribeImages',
          'ecr:GetDownloadUrlForLayer',
          'ecr:InitiateLayerUpload',
          'ecr:PutImage',
          'ecr:UploadLayerPart',
        ],
        resources: [this.repository.repositoryArn],
      }),
    );

    new CfnOutput(this, 'RepositoryName', { value: this.repository.repositoryName });
    new CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'Worker image repository (images are referenced by digest)',
    });
    new CfnOutput(this, 'ImagePublisherRoleArn', {
      value: this.publisherRole.roleArn,
      description: `GitHub environment processing-${env}: variable LAI_PROCESSING_PUBLISHER_ROLE_ARN`,
    });
  }
}

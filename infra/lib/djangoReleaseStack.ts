import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import {
  GITHUB_OIDC_HOST,
  githubOidcProviderArn,
  githubPrincipal,
  isGithubRepository,
} from './githubOidc';

/**
 * Account-wide release resources for the Django backend (ADR-037,
 * docs/platform/DJANGO_EC2_DEPLOYMENT.md): one ECR repository that every
 * environment deploys from (dev and prod run the very same image digest), the
 * GitHub OIDC provider, and the role GitHub Actions assumes on `main` to push
 * images. The role can push to this repository and nothing else: it cannot
 * deploy, read secrets or touch any instance.
 *
 * Deploying this stack is an owner-approved step; the repository synthesizes it.
 */

export const DJANGO_REPOSITORY_NAME = 'lai/django';
/** Release images kept in ECR (each is one commit on main). Untagged layers go after a week. */
export const KEPT_RELEASE_IMAGES = 100;
/** GitHub's published intermediate thumbprints; IAM no longer relies on them but CloudFormation accepts them. */
const GITHUB_THUMBPRINTS = [
  '6938fd4d98bab03faadb97b34396831e3780aea1',
  '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
];

export interface DjangoReleaseStackProps extends StackProps {
  /** `owner/repo` of the GitHub repository allowed to push images. */
  githubRepository: string;
  /** The branch whose workflow runs may push (default `main`). */
  releaseBranch?: string;
  /** False when the account already has the GitHub OIDC provider (it is one per account). */
  createOidcProvider?: boolean;
}

export class DjangoReleaseStack extends Stack {
  readonly repository: ecr.Repository;
  readonly publisherRole: iam.Role;

  constructor(scope: Construct, id: string, props: DjangoReleaseStackProps) {
    super(scope, id, { terminationProtection: true, ...props });
    if (!isGithubRepository(props.githubRepository)) {
      throw new Error(`githubRepository must be owner/repo, got "${props.githubRepository}"`);
    }
    const branch = props.releaseBranch ?? 'main';
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'django-release');

    if (props.createOidcProvider ?? true) {
      // The native resource: no custom-resource Lambda, so the stack stays bootstrapless.
      const provider = new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
        url: `https://${GITHUB_OIDC_HOST}`,
        clientIdList: ['sts.amazonaws.com'],
        thumbprintList: GITHUB_THUMBPRINTS,
      });
      provider.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }

    this.repository = new ecr.Repository(this, 'DjangoRepository', {
      repositoryName: DJANGO_REPOSITORY_NAME,
      // A tag (the full commit SHA) can never be moved to other content.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.AES_256,
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Untagged layers and failed pushes',
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(7),
        },
        {
          rulePriority: 2,
          description: `Keep the newest ${KEPT_RELEASE_IMAGES} release images`,
          tagStatus: ecr.TagStatus.ANY,
          maxImageCount: KEPT_RELEASE_IMAGES,
        },
      ],
      // Images of running releases must outlive the stack.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.publisherRole = new iam.Role(this, 'ImagePublisherRole', {
      roleName: 'lai-github-image-publisher',
      description: `GitHub Actions on ${props.githubRepository}@${branch}: push Django images to ECR`,
      assumedBy: githubPrincipal(
        githubOidcProviderArn(),
        `repo:${props.githubRepository}:ref:refs/heads/${branch}`,
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
        sid: 'PushDjangoImages',
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

    new CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'GitHub variable LAI_ECR_REPOSITORY_URI',
    });
    new CfnOutput(this, 'ImagePublisherRoleArn', {
      value: this.publisherRole.roleArn,
      description: 'GitHub variable LAI_IMAGE_PUBLISHER_ROLE_ARN',
    });
    new CfnOutput(this, 'GithubOidcProviderArn', { value: githubOidcProviderArn() });
  }
}

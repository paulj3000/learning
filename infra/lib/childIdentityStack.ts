import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { AssetEnvironment } from './assetStorageStack';

/**
 * The child Cognito user pool (independent child sign-in, ADR-075;
 * docs/platform/FAMILY_CHILD_AUTHENTICATION.md). Separate from the parent
 * pool, which is unchanged and not managed here.
 *
 * - Username sign-in only: the child types `preferred_username` (the login
 *   name the parent chose); the pool's own username is an opaque value Django
 *   generates. No email, no phone, nothing to verify, no messages sent.
 * - No public sign-up (`AllowAdminCreateUserOnly`), no self-service recovery
 *   (`AccountRecovery.NONE`): only Django, on a parent's request, creates
 *   users or sets passwords (`lai/apps/users/child_identity.py`).
 * - One public app client, SRP only, no secret, no OAuth, no hosted UI, no
 *   writable attributes (a child cannot change their own username), token
 *   revocation on, short token lifetimes: the browser exchanges the access
 *   token for a Django child session within minutes and discards it.
 * - Django gets a managed policy with exactly the admin calls it makes, on
 *   this pool only.
 *
 * Synthesized only when `LAI_ENABLE_CHILD_POOL=1` (bin/app.ts). Deploying it
 * is an owner approval (G7); nothing in the repository provisions it.
 */

/** Child-friendly minimum; Django checks the same rule first (child_auth.validate_password). */
export const CHILD_PASSWORD_MIN_LENGTH = 8;

/** Exactly what `CognitoChildIdentityProvider` calls. */
export const DJANGO_CHILD_POOL_ACTIONS = [
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminDeleteUser',
  'cognito-idp:AdminDisableUser',
  'cognito-idp:AdminEnableUser',
  'cognito-idp:AdminGetUser',
  'cognito-idp:AdminSetUserPassword',
  'cognito-idp:AdminUpdateUserAttributes',
  'cognito-idp:AdminUserGlobalSignOut',
] as const;

export interface ChildIdentityStackProps extends StackProps {
  envName: AssetEnvironment;
  /** The Django service's IAM role, when it is not the instance role (which attaches the policy itself). */
  djangoRoleArn?: string;
}

export class ChildIdentityStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly djangoPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: ChildIdentityStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'child-identity');
    Tags.of(this).add('Environment', props.envName);
    Tags.of(this).add('DataClassification', 'child-personal-data');

    this.userPool = new cognito.UserPool(this, 'ChildUserPool', {
      userPoolName: `lai-children-${props.envName}`,
      selfSignUpEnabled: false,
      signInAliases: { username: true, preferredUsername: true },
      signInCaseSensitive: false,
      autoVerify: {},
      standardAttributes: { preferredUsername: { required: false, mutable: true } },
      accountRecovery: cognito.AccountRecovery.NONE,
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: CHILD_PASSWORD_MIN_LENGTH,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(1),
      },
      deletionProtection: props.envName === 'prod',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.client = this.userPool.addClient('ChildWebClient', {
      userPoolClientName: `lai-children-web-${props.envName}`,
      generateSecret: false,
      authFlows: { userSrp: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(5),
      idTokenValidity: Duration.minutes(5),
      refreshTokenValidity: Duration.minutes(60),
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({
        preferredUsername: true,
      }),
      writeAttributes: new cognito.ClientAttributes(),
    });

    this.djangoPolicy = new iam.ManagedPolicy(this, 'DjangoChildIdentityPolicy', {
      managedPolicyName: `lai-django-child-identity-${props.envName}`,
      description: 'Django: create and manage child sign-ins in the child user pool only.',
      statements: [
        new iam.PolicyStatement({
          sid: 'ChildPoolAdministration',
          actions: [...DJANGO_CHILD_POOL_ACTIONS],
          resources: [this.userPool.userPoolArn],
        }),
      ],
    });
    if (props.djangoRoleArn) {
      this.djangoPolicy.attachToRole(
        iam.Role.fromRoleArn(this, 'DjangoRole', props.djangoRoleArn, { mutable: true }),
      );
    }

    new CfnOutput(this, 'ChildUserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Django COGNITO_CHILD_USER_POOL_ID and React VITE_COGNITO_CHILD_USER_POOL_ID',
    });
    new CfnOutput(this, 'ChildWebClientId', {
      value: this.client.userPoolClientId,
      description: 'Django COGNITO_CHILD_ALLOWED_CLIENT_IDS and React VITE_COGNITO_CHILD_CLIENT_ID',
    });
    new CfnOutput(this, 'DjangoChildIdentityPolicyArn', {
      value: this.djangoPolicy.managedPolicyArn,
      description: 'Attach to the Django workload role if djangoRoleArn was not given',
    });
  }
}

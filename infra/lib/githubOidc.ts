import { Aws } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * GitHub Actions OpenID Connect (ADR-037). Roles trust tokens from this
 * provider only for one repository and one `sub` claim, so no AWS access key
 * is ever stored in GitHub.
 */

export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/** `owner/repo`, as GitHub writes it in the token's `sub` claim. */
export function isGithubRepository(value: string): boolean {
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value);
}

/** The account's GitHub OIDC provider ARN (one per account; created by LaiDjangoRelease). */
export function githubOidcProviderArn(): string {
  return `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:oidc-provider/${GITHUB_OIDC_HOST}`;
}

/**
 * A principal for GitHub workflow runs whose token `sub` equals exactly one
 * value, for example `repo:owner/name:ref:refs/heads/main` (a job without a
 * GitHub environment on main) or `repo:owner/name:environment:django-prod`.
 */
export function githubPrincipal(providerArn: string, subject: string): iam.IPrincipal {
  return new iam.WebIdentityPrincipal(providerArn, {
    StringEquals: {
      [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
      [`${GITHUB_OIDC_HOST}:sub`]: subject,
    },
  });
}

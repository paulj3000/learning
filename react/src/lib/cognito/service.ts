import type { CognitoConfig } from './config';

/**
 * The Cognito user pool API over plain HTTPS (AMP-02): the public,
 * unauthenticated-by-SigV4 operations a browser app client may call, sent
 * as `application/x-amz-json-1.1` with `X-Amz-Target`. No AWS credentials
 * are involved; calls that act on a signed-in user carry its access token.
 */

export type CognitoOperation =
  | 'InitiateAuth'
  | 'RespondToAuthChallenge'
  | 'SignUp'
  | 'ConfirmSignUp'
  | 'ResendConfirmationCode'
  | 'ForgotPassword'
  | 'ConfirmForgotPassword'
  | 'RevokeToken'
  | 'GetUser'
  | 'UpdateUserAttributes'
  | 'VerifyUserAttribute'
  | 'ChangePassword'
  | 'DeleteUser';

/**
 * A Cognito failure. `name` is Cognito's exception name (for example
 * `NotAuthorizedException`), which is what the forms translate into
 * friendly text; the service's own message is kept for diagnostics only and
 * never shown to a parent.
 */
export class CognitoError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export type CognitoFetch = typeof fetch;

export interface CognitoService {
  call<T>(operation: CognitoOperation, body: Record<string, unknown>): Promise<T>;
}

export function createCognitoService(
  config: CognitoConfig,
  doFetch: CognitoFetch = (input, init) => globalThis.fetch(input, init),
): CognitoService {
  const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
  return {
    async call<T>(operation: CognitoOperation, body: Record<string, unknown>): Promise<T> {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
          },
          cache: 'no-store',
          body: JSON.stringify(body),
        });
      } catch {
        throw new CognitoError('NetworkError', 'Cognito could not be reached');
      }
      let data: unknown = {};
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = {};
        }
      }
      if (!response.ok) throw errorFrom(response.status, data);
      return data as T;
    },
  };
}

function errorFrom(status: number, data: unknown): CognitoError {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const type = typeof record.__type === 'string' ? record.__type : '';
  // `__type` is either the bare name or `namespace#Name`.
  const name = type.split('#').pop() || (status >= 500 ? 'ServiceError' : 'UnknownError');
  const message =
    typeof record.message === 'string'
      ? record.message
      : typeof record.Message === 'string'
        ? record.Message
        : `Cognito error ${status}`;
  return new CognitoError(name, message);
}

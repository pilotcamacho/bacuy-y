/** Maps Amplify / Cognito auth errors to i18n keys under `auth.errors`. */
const KNOWN: Record<string, string> = {
  UserNotFoundException: "auth.errors.wrongCredentials",
  NotAuthorizedException: "auth.errors.wrongCredentials",
  UsernameExistsException: "auth.errors.userExists",
  UserNotConfirmedException: "auth.errors.notConfirmed",
  CodeMismatchException: "auth.errors.wrongCode",
  ExpiredCodeException: "auth.errors.expiredCode",
  InvalidPasswordException: "auth.errors.weakPassword",
  InvalidParameterException: "auth.errors.invalidInput",
  LimitExceededException: "auth.errors.tooManyAttempts",
  TooManyRequestsException: "auth.errors.tooManyAttempts",
  TooManyFailedAttemptsException: "auth.errors.tooManyAttempts",
  EmptySignInUsername: "auth.errors.invalidInput",
  EmptySignInPassword: "auth.errors.invalidInput",
  EmptySignUpUsername: "auth.errors.invalidInput",
  EmptySignUpPassword: "auth.errors.invalidInput",
  NetworkError: "auth.errors.network",
};

export function authErrorKey(e: unknown): string {
  if (globalThis.navigator?.onLine === false) return "auth.errors.network";
  const name = (e as { name?: string } | null)?.name ?? "";
  return KNOWN[name] ?? "auth.errors.generic";
}

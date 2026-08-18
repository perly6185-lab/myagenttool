const TRANSIENT_REGISTRATION_ERROR = /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i;
const EXPIRED_BRIDGE_CREDENTIAL_ERROR = /bridge_credentials_expired/i;

export function isTransientBridgeRegistrationError(error) {
  const message = error instanceof Error
    ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
    : String(error ?? "");
  return TRANSIENT_REGISTRATION_ERROR.test(message);
}

export function isExpiredBridgeCredentialError(error) {
  const message = error instanceof Error
    ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
    : String(error ?? "");
  return EXPIRED_BRIDGE_CREDENTIAL_ERROR.test(message);
}

/**
 * A locally launched bridge can safely recover an idle-expired credential via
 * the Electron launch-token boundary. Other credential failures remain
 * explicit operator actions (unlink/re-pair), so an intentional revoke is not
 * silently undone.
 */
export async function registerBridgeWithRecovery(register, {
  recoverExpiredCredential = null,
  resetCredential = () => {},
} = {}) {
  try {
    return await register();
  } catch (error) {
    if (!recoverExpiredCredential || !isExpiredBridgeCredentialError(error)) {
      throw error;
    }
    await recoverExpiredCredential(error);
    resetCredential();
    return register();
  }
}

export async function registerBridgeWithRetry(register, {
  attempts = 3,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  delayMs = 250,
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await register();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientBridgeRegistrationError(error)) throw error;
      onRetry(error, attempt);
      await delay(delayMs * attempt);
    }
  }
  throw lastError;
}

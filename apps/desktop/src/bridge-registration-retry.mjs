const TRANSIENT_REGISTRATION_ERROR = /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i;

export function isTransientBridgeRegistrationError(error) {
  const message = error instanceof Error
    ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
    : String(error ?? "");
  return TRANSIENT_REGISTRATION_ERROR.test(message);
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

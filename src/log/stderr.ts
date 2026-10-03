/**
 * Structured server logger writing to process.stderr.
 * Uses process.stderr.write to avoid console.log in src.
 */
export function logInfo(message: string): void {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [INFO] ${message}\n`);
}

export function logWarn(message: string): void {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [WARN] ${message}\n`);
}

export function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  const errorDetails =
    error !== undefined
      ? ` - ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      : "";
  process.stderr.write(`[${timestamp}] [ERROR] ${message}${errorDetails}\n`);
}

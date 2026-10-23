/** Removes secrets from a message before it can reach a log, a database row or the UI. */
export function redactSecrets(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out.replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
}

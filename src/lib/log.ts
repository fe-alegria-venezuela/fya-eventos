type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${scope}] ${msg}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (data === undefined) fn(prefix);
  else fn(prefix, typeof data === "string" ? data : JSON.stringify(data));
}

export function logger(scope: string) {
  return {
    info: (msg: string, data?: unknown) => emit("info", scope, msg, data),
    warn: (msg: string, data?: unknown) => emit("warn", scope, msg, data),
    error: (msg: string, data?: unknown) => emit("error", scope, msg, data),
  };
}

// Masks a token/key: keeps first 4 + last 4 chars.
export function mask(s: string | undefined | null): string {
  if (!s) return "<empty>";
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

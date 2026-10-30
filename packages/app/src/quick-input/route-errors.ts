import type { AgentProvider } from "@getpaseo/protocol/agent-types";

export type QuickInputSlowRouteErrorCode =
  | "auth"
  | "timeout"
  | "unavailable"
  | "no_providers"
  | "invalid_response"
  | "unknown";

const AUTHENTICATION_ERROR_PATTERN =
  /api[_ -]?key[^\n]*(expired|invalid|revoked)|authentication_error|authentication failed|invalid_api_key|incorrect api key|unauthorized|\b401\b/i;
const TIMEOUT_ERROR_PATTERN = /timed out|timeout|etimedout|deadline exceeded/i;
const ROUTE_ERROR_CODES = new Set<QuickInputSlowRouteErrorCode>([
  "auth",
  "timeout",
  "unavailable",
  "no_providers",
  "invalid_response",
  "unknown",
]);

function readErrorCode(error: unknown): QuickInputSlowRouteErrorCode | null {
  if (!error || typeof error !== "object" || !("errorCode" in error)) {
    return null;
  }
  const value = (error as { errorCode?: unknown }).errorCode;
  return typeof value === "string" && ROUTE_ERROR_CODES.has(value as QuickInputSlowRouteErrorCode)
    ? (value as QuickInputSlowRouteErrorCode)
    : null;
}

function readErrorProvider(error: unknown): AgentProvider | null {
  if (!error || typeof error !== "object" || !("errorProvider" in error)) {
    return null;
  }
  const value = (error as { errorProvider?: unknown }).errorProvider;
  return typeof value === "string" && value.trim().length > 0 ? (value as AgentProvider) : null;
}

export function classifyQuickInputRouteError(error: unknown): {
  code: QuickInputSlowRouteErrorCode;
  provider: AgentProvider | null;
} {
  const message = error instanceof Error ? error.message : String(error);
  const provider = readErrorProvider(error);
  const explicitCode = readErrorCode(error);
  if (explicitCode && explicitCode !== "unknown") {
    return { code: explicitCode, provider };
  }
  if (AUTHENTICATION_ERROR_PATTERN.test(message)) {
    return { code: "auth", provider };
  }
  if (TIMEOUT_ERROR_PATTERN.test(message)) {
    return { code: "timeout", provider };
  }
  return { code: explicitCode ?? "unknown", provider };
}

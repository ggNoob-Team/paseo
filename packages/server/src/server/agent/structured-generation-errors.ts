import type { AgentProvider } from "./agent-sdk-types.js";
import {
  isStructuredGenerationAuthenticationError,
  StructuredAgentFallbackError,
  StructuredAgentResponseError,
} from "./agent-response-loop.js";

export type StructuredGenerationFailureCode =
  | "auth"
  | "timeout"
  | "unavailable"
  | "no_providers"
  | "invalid_response"
  | "unknown";

export interface StructuredGenerationFailure {
  code: StructuredGenerationFailureCode;
  message: string;
  provider: AgentProvider | null;
}

const TIMEOUT_FAILURE_PATTERN = /timed out|timeout|etimedout|deadline exceeded/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortMessage(value: string, maxLength = 240): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function isTimeoutFailure(error: unknown): boolean {
  return TIMEOUT_FAILURE_PATTERN.test(errorMessage(error));
}

export function describeStructuredGenerationFailure(error: unknown): StructuredGenerationFailure {
  if (error instanceof StructuredAgentFallbackError) {
    const attempts = error.attempts;
    if (attempts.length === 0) {
      return {
        code: "no_providers",
        message: "No model provider is available for routing.",
        provider: null,
      };
    }

    const authenticationAttempt = attempts.find(
      (attempt) => attempt.error && isStructuredGenerationAuthenticationError(attempt.error),
    );
    const nonAuthenticationAttempt = attempts.find(
      (attempt) => attempt.available && !isStructuredGenerationAuthenticationError(attempt.error),
    );
    if (authenticationAttempt && !nonAuthenticationAttempt) {
      const provider = authenticationAttempt.provider;
      return {
        code: "auth",
        message: `${provider} API key is missing, invalid, or expired. Update it in Settings > Providers.`,
        provider,
      };
    }

    if (attempts.every((attempt) => !attempt.available)) {
      const first = attempts[0];
      return {
        code: "unavailable",
        message: `${first.provider} is unavailable${
          first.error ? `: ${shortMessage(first.error, 120)}` : ""
        }.`,
        provider: first.provider,
      };
    }

    const timedOut = attempts.find((attempt) => attempt.error && isTimeoutFailure(attempt.error));
    if (timedOut) {
      return {
        code: "timeout",
        message: "The model check timed out before a route was chosen.",
        provider: timedOut.provider,
      };
    }

    return {
      code: "unknown",
      message: shortMessage(error.message),
      provider: attempts[0]?.provider ?? null,
    };
  }

  if (error instanceof StructuredAgentResponseError) {
    return {
      code: "invalid_response",
      message: "The model returned a route that could not be validated.",
      provider: null,
    };
  }

  if (isStructuredGenerationAuthenticationError(error)) {
    return {
      code: "auth",
      message: "The selected model API key is missing, invalid, or expired.",
      provider: null,
    };
  }

  if (isTimeoutFailure(error)) {
    return {
      code: "timeout",
      message: "The model check timed out before a route was chosen.",
      provider: null,
    };
  }

  return {
    code: "unknown",
    message: shortMessage(errorMessage(error)),
    provider: null,
  };
}

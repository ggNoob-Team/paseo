import { describe, expect, test } from "vitest";

import {
  StructuredAgentFallbackError,
  StructuredAgentResponseError,
} from "./agent-response-loop.js";
import { describeStructuredGenerationFailure } from "./structured-generation-errors.js";

describe("describeStructuredGenerationFailure", () => {
  test("identifies an expired API key and keeps the provider", () => {
    const error = new StructuredAgentFallbackError([
      {
        provider: "opencode",
        model: "opencode/deepseek-v4.1-flash",
        available: true,
        error:
          '{"name":"APIError","data":{"message":"This API key has expired.","statusCode":401}}',
      },
    ]);

    expect(describeStructuredGenerationFailure(error)).toEqual({
      code: "auth",
      message:
        "opencode API key is missing, invalid, or expired. Update it in Settings > Providers.",
      provider: "opencode",
    });
  });

  test("identifies a timeout", () => {
    const error = new StructuredAgentFallbackError([
      {
        provider: "opencode",
        model: "opencode/deepseek-v4.1-flash",
        available: true,
        error: "Request timed out after 20000ms",
      },
    ]);

    expect(describeStructuredGenerationFailure(error).code).toBe("timeout");
  });

  test("reports when every provider is unavailable", () => {
    const error = new StructuredAgentFallbackError([
      {
        provider: "opencode",
        model: "opencode/deepseek-v4.1-flash",
        available: false,
        error: "not installed",
      },
    ]);

    expect(describeStructuredGenerationFailure(error)).toMatchObject({
      code: "unavailable",
      provider: "opencode",
    });
  });

  test("reports when no provider could be resolved", () => {
    expect(describeStructuredGenerationFailure(new StructuredAgentFallbackError([]))).toMatchObject(
      {
        code: "no_providers",
        provider: null,
      },
    );
  });

  test("identifies an invalid structured response", () => {
    const error = new StructuredAgentResponseError("invalid", {
      lastResponse: "not json",
      validationErrors: ["Invalid JSON"],
    });

    expect(describeStructuredGenerationFailure(error).code).toBe("invalid_response");
  });
});

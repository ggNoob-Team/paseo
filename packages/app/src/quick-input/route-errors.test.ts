import { describe, expect, test } from "vitest";

import { classifyQuickInputRouteError } from "./route-errors";

describe("classifyQuickInputRouteError", () => {
  test("keeps the server error code and provider", () => {
    const error = Object.assign(new Error("expired"), {
      errorCode: "auth",
      errorProvider: "opencode",
    });

    expect(classifyQuickInputRouteError(error)).toEqual({
      code: "auth",
      provider: "opencode",
    });
  });

  test("classifies a client timeout", () => {
    expect(
      classifyQuickInputRouteError(new Error("Timeout waiting for message (20000ms)")),
    ).toEqual({ code: "timeout", provider: null });
  });

  test("recognizes an authentication failure from an older host", () => {
    expect(
      classifyQuickInputRouteError(
        new Error('APIError: {"message":"This API key has expired.","statusCode":401}'),
      ).code,
    ).toBe("auth");
  });
});

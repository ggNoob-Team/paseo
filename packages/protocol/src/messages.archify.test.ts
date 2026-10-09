import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("archify evidence protocol", () => {
  it("round-trips the evidence scan request and response", () => {
    const request = {
      type: "archify.evidence.scan.request",
      requestId: "r1",
      workspaceId: "ws_1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse({ ...request, force: true }).force).toBe(true);

    const evidence = {
      workspaceId: "ws_1",
      revision: "git:abc",
      scannedAt: "2026-10-09T00:00:00.000Z",
      cached: true,
      digest: "# Repository evidence\n",
      digestBytes: 22,
      truncated: false,
      facts: { packages: 3, entryPoints: 4, sourceFiles: 120 },
      anchors: [{ kind: "module" as const, label: "@fixture/core", detail: "packages/core" }],
    };
    const response = {
      type: "archify.evidence.scan.response",
      payload: { requestId: "r1", evidence },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

import { describe, expect, it } from "vitest";
import { isQuickInputCandidate } from "./candidates";

const candidate = {
  archivedAt: null,
  parentAgentId: null,
  labels: {},
};

describe("isQuickInputCandidate", () => {
  it("includes ordinary root sessions, including ones without a resolved workspace", () => {
    expect(isQuickInputCandidate(candidate, undefined)).toBe(true);
    expect(isQuickInputCandidate(candidate, { background: false, archivingAt: null })).toBe(true);
  });

  it("excludes archived sessions", () => {
    expect(
      isQuickInputCandidate(
        { ...candidate, archivedAt: new Date("2026-10-30T00:00:00Z") },
        { archivingAt: null },
      ),
    ).toBe(false);
  });

  it("excludes subagent sessions", () => {
    expect(
      isQuickInputCandidate({ ...candidate, parentAgentId: "parent" }, { archivingAt: null }),
    ).toBe(false);
  });

  it("excludes background generator sessions", () => {
    expect(
      isQuickInputCandidate(
        { ...candidate, labels: { "paseo.archify.generator": "true" } },
        { archivingAt: null },
      ),
    ).toBe(false);
  });

  it("excludes sessions from background workspaces", () => {
    expect(isQuickInputCandidate(candidate, { background: true, archivingAt: null })).toBe(false);
  });
});

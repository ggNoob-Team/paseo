import { describe, expect, test } from "vitest";
import type { NoteProjectPayload } from "@getpaseo/protocol/messages";
import {
  countPendingNoteEntries,
  mergeProjectNoteSummaries,
  resolveNoteGenerationState,
  type HostProjectNoteSummary,
} from "./notes-model";

function summary(overrides: Partial<HostProjectNoteSummary>): HostProjectNoteSummary {
  return {
    serverId: "srv_1",
    hostLabel: "Host 1",
    projectId: "prj_1",
    projectName: "Alpha",
    entryCount: 1,
    pendingEntryCount: 0,
    hasBody: true,
    lastError: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function note(overrides: Partial<NoteProjectPayload>): NoteProjectPayload {
  return {
    projectId: "prj_1",
    projectName: "Alpha",
    body: "",
    bodyUpdatedAt: null,
    entries: [],
    lastError: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeProjectNoteSummaries", () => {
  test("orders by most recent activity, then project name", () => {
    const merged = mergeProjectNoteSummaries([
      summary({ projectId: "b", projectName: "Beta", updatedAt: "2026-05-01T00:00:00.000Z" }),
      summary({ projectId: "c", projectName: "Gamma", updatedAt: "2026-05-02T00:00:00.000Z" }),
      summary({ projectId: "a", projectName: "Alpha", updatedAt: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(merged.map((row) => row.projectName)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  test("keeps the same project on two hosts as two rows", () => {
    const merged = mergeProjectNoteSummaries([
      summary({ serverId: "srv_1" }),
      summary({ serverId: "srv_2" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("resolveNoteGenerationState", () => {
  test("is organizing while any entry is pending", () => {
    const entry = {
      entryId: "e1",
      createdAt: "2026-05-01T00:00:00.000Z",
      text: "snippet",
      comment: null,
      source: { workspaceId: null, agentId: null },
      organizedAt: null,
    };
    expect(resolveNoteGenerationState(note({ entries: [entry] }))).toBe("organizing");
    expect(countPendingNoteEntries(note({ entries: [entry] }))).toBe(1);
  });

  test("reports a failure even while entries are still pending", () => {
    expect(resolveNoteGenerationState(note({ lastError: "no provider" }))).toBe("failed");
    expect(
      resolveNoteGenerationState(
        note({
          lastError: "no provider",
          entries: [
            {
              entryId: "e1",
              createdAt: "2026-05-01T00:00:00.000Z",
              text: "snippet",
              comment: null,
              source: { workspaceId: null, agentId: null },
              organizedAt: null,
            },
          ],
        }),
      ),
    ).toBe("failed");
  });

  test("is idle for a clean note", () => {
    expect(resolveNoteGenerationState(note({}))).toBe("idle");
    expect(resolveNoteGenerationState(null)).toBe("idle");
  });
});

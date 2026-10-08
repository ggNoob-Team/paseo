import { describe, expect, test } from "vitest";
import { findNoteById, mergeNotes, noteDisplayTitle, type HostNote } from "./notes-model";

function note(overrides: Partial<HostNote> & { noteId: string }): HostNote {
  return {
    serverId: "srv_1",
    hostLabel: "Host 1",
    projectId: "prj_1",
    projectName: "Alpha",
    title: null,
    text: "text",
    comment: null,
    source: { workspaceId: null, agentId: null },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeNotes", () => {
  test("orders by most recent edit and keeps every capture", () => {
    const merged = mergeNotes([
      note({ noteId: "b", updatedAt: "2026-05-01T00:00:00.000Z" }),
      note({ noteId: "a", updatedAt: "2026-05-02T00:00:00.000Z" }),
      note({ noteId: "c", updatedAt: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(merged.map((entry) => entry.noteId)).toEqual(["a", "b", "c"]);
  });

  test("keeps notes from different hosts apart", () => {
    const merged = mergeNotes([
      note({ noteId: "a", serverId: "srv_1" }),
      note({ noteId: "b", serverId: "srv_2" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("noteDisplayTitle", () => {
  test("prefers the user's title", () => {
    expect(noteDisplayTitle({ title: "  Plan  ", text: "body" })).toBe("Plan");
  });

  test("falls back to the first line of the text", () => {
    expect(noteDisplayTitle({ title: null, text: "first line\nsecond line" })).toBe("first line");
    expect(noteDisplayTitle({ title: "  ", text: "only line" })).toBe("only line");
  });
});

describe("findNoteById", () => {
  test("finds a note or reports nothing", () => {
    const notes = [note({ noteId: "a" })];
    expect(findNoteById(notes, "a")?.noteId).toBe("a");
    expect(findNoteById(notes, "missing")).toBeNull();
    expect(findNoteById(notes, null)).toBeNull();
  });
});

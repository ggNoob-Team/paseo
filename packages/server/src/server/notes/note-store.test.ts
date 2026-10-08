import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { NoteStore } from "./note-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<{ store: NoteStore; paseoHome: string }> {
  const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-notes-"));
  directories.push(paseoHome);
  return { store: new NoteStore(paseoHome), paseoHome };
}

describe("NoteStore", () => {
  test("stores one note per capture, newest first", async () => {
    const { store, paseoHome } = await createStore();

    const first = await store.create({ projectId: "prj_a", text: "first" });
    const second = await store.create({
      projectId: "prj_a",
      text: "second",
      title: "  A title  ",
      comment: "  why it matters  ",
      source: { workspaceId: "ws_1", agentId: "agent_1" },
    });

    expect(first.noteId).not.toBe(second.noteId);
    expect(first.title).toBeNull();
    expect(second.title).toBe("A title");
    expect(second.comment).toBe("why it matters");
    expect(second.source).toEqual({ workspaceId: "ws_1", agentId: "agent_1" });

    const notes = await store.list();
    expect(notes.map((note) => note.text)).toEqual(["second", "first"]);

    const raw = JSON.parse(await readFile(path.join(paseoHome, "notes", "prj_a.json"), "utf8"));
    expect(raw.projectId).toBe("prj_a");
    expect(raw.notes).toHaveLength(2);

    // A different project is a different file.
    expect(await store.listForProject("prj_b")).toEqual([]);
  });

  test("edits keep the note's identity and clear a title when asked", async () => {
    const { store } = await createStore();
    const created = await store.create({ projectId: "prj_a", text: "text", title: "Title" });

    const renamed = await store.update({
      projectId: "prj_a",
      noteId: created.noteId,
      title: "   ",
      text: "edited",
    });

    expect(renamed?.noteId).toBe(created.noteId);
    expect(renamed?.title).toBeNull();
    expect(renamed?.text).toBe("edited");
    expect(renamed?.createdAt).toBe(created.createdAt);
    expect(renamed?.updatedAt >= created.updatedAt).toBe(true);
  });

  test("deletes one note and drops the project file with the last one", async () => {
    const { store, paseoHome } = await createStore();
    const first = await store.create({ projectId: "prj_a", text: "first" });
    await store.create({ projectId: "prj_a", text: "second" });

    expect(await store.delete({ projectId: "prj_a", noteId: first.noteId })).toBe(true);
    expect((await store.listForProject("prj_a")).map((note) => note.text)).toEqual(["second"]);
    expect(await store.delete({ projectId: "prj_a", noteId: "missing" })).toBe(false);

    const second = await store.listForProject("prj_a");
    expect(await store.delete({ projectId: "prj_a", noteId: second[0]!.noteId })).toBe(true);
    await expect(readFile(path.join(paseoHome, "notes", "prj_a.json"), "utf8")).rejects.toThrow();
  });

  test("reads a legacy one-note-per-project file as one note per entry", async () => {
    const { store, paseoHome } = await createStore();
    const notesDirectory = path.join(paseoHome, "notes");
    await rm(notesDirectory, { recursive: true, force: true });
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(notesDirectory, { recursive: true }),
    );
    await writeFile(
      path.join(notesDirectory, "prj_legacy.json"),
      JSON.stringify({
        projectId: "prj_legacy",
        body: "# Organized\n\n- one\n- two",
        bodyUpdatedAt: "2026-05-02T00:00:00.000Z",
        entries: [
          {
            entryId: "note_entry_1",
            createdAt: "2026-05-01T00:00:00.000Z",
            text: "one",
            comment: null,
            source: { workspaceId: null, agentId: null },
            organizedAt: "2026-05-02T00:00:00.000Z",
          },
          {
            entryId: "note_entry_2",
            createdAt: "2026-05-01T01:00:00.000Z",
            text: "two",
            comment: "kept",
            source: { workspaceId: "ws_1", agentId: null },
            organizedAt: null,
          },
        ],
        lastError: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    );

    const notes = await store.listForProject("prj_legacy");
    expect(notes.map((note) => note.text)).toEqual(["one", "two"]);
    expect(notes[0]?.noteId).toBe("note_entry_1");
    expect(notes[0]?.updatedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(notes[1]?.comment).toBe("kept");
    expect(notes[1]?.updatedAt).toBe("2026-05-01T01:00:00.000Z");
  });

  test("keeps a legacy body that had no entries", async () => {
    const { store, paseoHome } = await createStore();
    const notesDirectory = path.join(paseoHome, "notes");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(notesDirectory, { recursive: true }),
    );
    await writeFile(
      path.join(notesDirectory, "prj_body.json"),
      JSON.stringify({
        projectId: "prj_body",
        body: "only the organized document",
        bodyUpdatedAt: "2026-05-02T00:00:00.000Z",
        entries: [],
        lastError: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    );

    const notes = await store.listForProject("prj_body");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe("only the organized document");
  });

  test("concurrent captures all survive", async () => {
    const { store } = await createStore();
    await Promise.all([
      store.create({ projectId: "prj_a", text: "one" }),
      store.create({ projectId: "prj_a", text: "two" }),
      store.create({ projectId: "prj_a", text: "three" }),
    ]);

    const notes = await store.listForProject("prj_a");
    expect(notes.map((note) => note.text).sort()).toEqual(["one", "three", "two"]);
  });
});

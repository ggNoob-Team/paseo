import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  test("creates one file per project and appends entries in order", async () => {
    const { store, paseoHome } = await createStore();

    const first = await store.appendEntry({ projectId: "prj_a", text: "first" });
    const second = await store.appendEntry({
      projectId: "prj_a",
      text: "second",
      comment: "  why it matters  ",
      source: { workspaceId: "ws_1", agentId: "agent_1" },
    });

    expect(first.body).toBe("");
    expect(second.entries.map((entry) => entry.text)).toEqual(["first", "second"]);
    expect(second.entries[1]?.comment).toBe("why it matters");
    expect(second.entries[1]?.source).toEqual({ workspaceId: "ws_1", agentId: "agent_1" });
    expect(second.entries.every((entry) => entry.organizedAt === null)).toBe(true);

    const raw = await readFile(path.join(paseoHome, "notes", "prj_a.json"), "utf8");
    expect(JSON.parse(raw).projectId).toBe("prj_a");

    // A different project is a different note.
    expect(await store.get("prj_b")).toBeNull();
  });

  test("reads nothing for an unknown or malformed note", async () => {
    const { store } = await createStore();
    expect(await store.get("prj_missing")).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  test("applies a generation run to the body and only the entries it folded in", async () => {
    const { store } = await createStore();
    const appended = await store.appendEntry({ projectId: "prj_a", text: "one" });
    await store.appendEntry({ projectId: "prj_a", text: "two" });
    const firstEntryId = appended.entries[0]!.entryId;

    const updated = await store.applyGeneration({
      projectId: "prj_a",
      body: "# Note\n\none",
      organizedEntryIds: [firstEntryId],
      generatedAt: "2026-05-01T00:00:00.000Z",
    });

    expect(updated?.body).toBe("# Note\n\none");
    expect(updated?.bodyUpdatedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(updated?.entries[0]?.organizedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(updated?.entries[1]?.organizedAt).toBeNull();
  });

  test("keeps a manual body edit and clears the last generation error", async () => {
    const { store } = await createStore();
    await store.appendEntry({ projectId: "prj_a", text: "one" });
    await store.recordGenerationError({ projectId: "prj_a", error: "no provider" });
    expect((await store.get("prj_a"))?.lastError).toBe("no provider");

    const edited = await store.setBody({ projectId: "prj_a", body: "hand written" });
    expect(edited?.body).toBe("hand written");
  });

  test("deleting an entry leaves the body alone", async () => {
    const { store } = await createStore();
    const appended = await store.appendEntry({ projectId: "prj_a", text: "one" });
    await store.appendEntry({ projectId: "prj_a", text: "two" });
    await store.applyGeneration({
      projectId: "prj_a",
      body: "organized",
      organizedEntryIds: appended.entries.map((entry) => entry.entryId),
      generatedAt: "2026-05-01T00:00:00.000Z",
    });

    const updated = await store.deleteEntry({
      projectId: "prj_a",
      entryId: appended.entries[0]!.entryId,
    });

    expect(updated?.entries.map((entry) => entry.text)).toEqual(["two"]);
    expect(updated?.body).toBe("organized");
  });

  test("appends racing from two callers keep both entries", async () => {
    const { store } = await createStore();
    await Promise.all([
      store.appendEntry({ projectId: "prj_a", text: "one" }),
      store.appendEntry({ projectId: "prj_a", text: "two" }),
      store.appendEntry({ projectId: "prj_a", text: "three" }),
    ]);

    const note = await store.get("prj_a");
    expect(note?.entries.map((entry) => entry.text).sort()).toEqual(["one", "three", "two"]);
  });
});

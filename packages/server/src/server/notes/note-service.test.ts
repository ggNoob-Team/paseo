import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { NoteService } from "./note-service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const PROJECTS = [
  {
    projectId: "prj_a",
    rootPath: "/repo/a",
    kind: "git" as const,
    displayName: "Alpha",
    customName: null,
    projectKey: null,
    customIconRevision: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  },
  {
    projectId: "prj_b",
    rootPath: "/repo/b",
    kind: "git" as const,
    displayName: "Beta",
    customName: "Renamed Beta",
    projectKey: null,
    customIconRevision: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  },
];

async function createService() {
  const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-notes-service-"));
  directories.push(paseoHome);
  return new NoteService({
    paseoHome,
    projectRegistry: {
      list: async () => PROJECTS,
      get: async (projectId) => PROJECTS.find((project) => project.projectId === projectId) ?? null,
    },
  });
}

describe("NoteService", () => {
  test("lists notes across projects with the project's display name", async () => {
    const service = await createService();
    await service.create({ projectId: "prj_a", text: "from alpha", title: "Alpha note" });
    await service.create({ projectId: "prj_b", text: "from beta" });

    const notes = await service.list();
    expect(notes.map((note) => note.projectName).sort()).toEqual(["Alpha", "Renamed Beta"]);
    expect(notes[0]).toMatchObject({ noteId: expect.stringContaining("note_") });
  });

  test("edits and deletes a single note", async () => {
    const service = await createService();
    const created = await service.create({ projectId: "prj_a", text: "text" });

    const updated = await service.update({
      projectId: "prj_a",
      noteId: created.noteId,
      title: "Title",
      text: "edited",
    });
    expect(updated).toMatchObject({ title: "Title", text: "edited", projectName: "Alpha" });

    expect(await service.delete({ projectId: "prj_a", noteId: created.noteId })).toBe(true);
    expect(await service.list()).toEqual([]);
  });

  test("answers the per-project RPCs from the notes that replaced them", async () => {
    const service = await createService();
    await service.createForLegacyAppend({ projectId: "prj_a", text: "captured" });
    await service.createForLegacyAppend({ projectId: "prj_a", text: "second" });

    const summaries = await service.listProjects();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      projectId: "prj_a",
      entryCount: 2,
      pendingEntryCount: 0,
      hasBody: false,
    });

    const project = await service.getProjectNotes("prj_a");
    expect(project.entries.map((entry) => entry.text).sort()).toEqual(["captured", "second"]);
    expect(project.body).toBe("");

    const entryId = project.entries[0]!.entryId;
    const afterDelete = await service.deleteForLegacyEntry({ projectId: "prj_a", entryId });
    expect(afterDelete?.entries).toHaveLength(1);
  });

  test("an empty project has no legacy note to return", async () => {
    const service = await createService();
    const project = await service.getProjectNotes("prj_a");
    expect(project.entries).toEqual([]);
  });
});

import type {
  NoteEntrySourcePayload,
  NoteProjectPayload,
  NoteProjectSummaryPayload,
  NoteRecordPayload,
} from "@getpaseo/protocol/messages";
import { resolveProjectDisplayName, type ProjectRegistry } from "../workspace-registry.js";
import {
  NoteStore,
  type CreateNoteInput,
  type PersistedNoteRecord,
  type UpdateNoteInput,
} from "./note-store.js";

export interface NoteServiceOptions {
  paseoHome: string;
  projectRegistry: Pick<ProjectRegistry, "get" | "list">;
}

/**
 * Notes are per capture, not per project: each one is what the user kept, with
 * an optional title and remark, editable and deletable on its own. The project
 * is where the note lives — the file it is stored in and the name shown beside
 * it — not a document the notes are folded into.
 */
export class NoteService {
  private readonly store: NoteStore;
  private readonly projectRegistry: Pick<ProjectRegistry, "get" | "list">;

  constructor(options: NoteServiceOptions) {
    this.store = new NoteStore(options.paseoHome);
    this.projectRegistry = options.projectRegistry;
  }

  async list(): Promise<NoteRecordPayload[]> {
    const [notes, projects] = await Promise.all([this.store.list(), this.projectRegistry.list()]);
    const nameByProjectId = new Map(
      projects.map((project) => [project.projectId, resolveProjectDisplayName(project)] as const),
    );
    return notes.map((note) =>
      toNoteRecordPayload(note, nameByProjectId.get(note.projectId) ?? note.projectId),
    );
  }

  async create(input: CreateNoteInput): Promise<NoteRecordPayload> {
    const note = await this.store.create(input);
    return this.toPayload(note);
  }

  async update(input: UpdateNoteInput): Promise<NoteRecordPayload | null> {
    const note = await this.store.update(input);
    return note ? this.toPayload(note) : null;
  }

  async delete(input: { projectId: string; noteId: string }): Promise<boolean> {
    return this.store.delete(input);
  }

  private async toPayload(note: PersistedNoteRecord): Promise<NoteRecordPayload> {
    const project = await this.projectRegistry.get(note.projectId);
    return toNoteRecordPayload(note, project ? resolveProjectDisplayName(project) : note.projectId);
  }

  // ---------------------------------------------------------------------------
  // Compatibility surface for the one-note-per-project RPCs
  //
  // The app talked to those until notes became per capture. They still answer,
  // mapped onto the new records, so a client that has not been updated keeps
  // working: an append creates a note, the project view lists them as entries,
  // and a delete removes the note behind that entry id.
  // ---------------------------------------------------------------------------

  async listProjects(): Promise<NoteProjectSummaryPayload[]> {
    const [notes, projects] = await Promise.all([this.store.list(), this.projectRegistry.list()]);
    const nameByProjectId = new Map(
      projects.map((project) => [project.projectId, resolveProjectDisplayName(project)] as const),
    );
    const byProjectId = new Map<string, PersistedNoteRecord[]>();
    for (const note of notes) {
      const existing = byProjectId.get(note.projectId);
      if (existing) existing.push(note);
      else byProjectId.set(note.projectId, [note]);
    }
    return Array.from(byProjectId, ([projectId, projectNotes]) => {
      const updatedAt = projectNotes.reduce(
        (latest, note) => (note.updatedAt > latest ? note.updatedAt : latest),
        projectNotes[0]?.updatedAt ?? new Date(0).toISOString(),
      );
      return {
        projectId,
        projectName: nameByProjectId.get(projectId) ?? projectId,
        entryCount: projectNotes.length,
        pendingEntryCount: 0,
        hasBody: false,
        lastError: null,
        updatedAt,
      } satisfies NoteProjectSummaryPayload;
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getProjectNotes(projectId: string): Promise<NoteProjectPayload> {
    const [notes, project] = await Promise.all([
      this.store.listForProject(projectId),
      this.projectRegistry.get(projectId),
    ]);
    return toNoteProjectPayload(
      projectId,
      project ? resolveProjectDisplayName(project) : projectId,
      notes,
    );
  }

  async createForLegacyAppend(input: {
    projectId: string;
    text: string;
    comment?: string | null;
    source?: NoteEntrySourcePayload;
  }): Promise<NoteProjectPayload> {
    await this.store.create({
      projectId: input.projectId,
      text: input.text,
      comment: input.comment ?? null,
      source: input.source ?? { workspaceId: null, agentId: null },
    });
    return this.getProjectNotes(input.projectId);
  }

  async deleteForLegacyEntry(input: {
    projectId: string;
    entryId: string;
  }): Promise<NoteProjectPayload | null> {
    const deleted = await this.store.delete({ projectId: input.projectId, noteId: input.entryId });
    if (!deleted) return null;
    const remaining = await this.store.listForProject(input.projectId);
    if (remaining.length === 0) return null;
    return this.getProjectNotes(input.projectId);
  }
}

export function toNoteRecordPayload(
  note: PersistedNoteRecord,
  projectName: string,
): NoteRecordPayload {
  return {
    noteId: note.noteId,
    projectId: note.projectId,
    projectName,
    title: note.title,
    text: note.text,
    comment: note.comment,
    source: note.source,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** The old per-project view, synthesized from the notes that replaced it. */
export function toNoteProjectPayload(
  projectId: string,
  projectName: string,
  notes: readonly PersistedNoteRecord[],
): NoteProjectPayload {
  const updatedAt = notes.reduce(
    (latest, note) => (note.updatedAt > latest ? note.updatedAt : latest),
    notes[0]?.updatedAt ?? new Date(0).toISOString(),
  );
  return {
    projectId,
    projectName,
    body: "",
    bodyUpdatedAt: null,
    entries: notes.map((note) => ({
      entryId: note.noteId,
      createdAt: note.createdAt,
      text: note.text,
      comment: note.comment,
      source: note.source,
      organizedAt: note.createdAt,
    })),
    lastError: null,
    updatedAt,
  };
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";

/**
 * Every capture is its own note. Notes live in one file per project —
 * `$PASEO_HOME/notes/{projectId}.json` — because that is the project they
 * belong to, but nothing downstream treats the file as one document: listing,
 * editing and deleting all work per note.
 */
const NoteRecordSchema = z.object({
  noteId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  text: z.string(),
  comment: z.string().nullable(),
  source: z.object({
    workspaceId: z.string().nullable(),
    agentId: z.string().nullable(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ProjectNotesFileSchema = z.object({
  projectId: z.string().min(1),
  notes: z.array(NoteRecordSchema),
});

/**
 * The shape written before notes became per-capture: one organized body plus
 * the entries folded into it. Read here so an install that predates the split
 * does not lose what the user already kept; the file is rewritten in the new
 * shape on the next write.
 */
const LegacyNoteEntrySchema = z.object({
  entryId: z.string(),
  createdAt: z.string(),
  text: z.string(),
  comment: z.string().nullable(),
  source: z.object({
    workspaceId: z.string().nullable(),
    agentId: z.string().nullable(),
  }),
  organizedAt: z.string().nullable(),
});

const LegacyProjectNotesFileSchema = z.object({
  projectId: z.string().min(1),
  body: z.string(),
  bodyUpdatedAt: z.string().nullable(),
  entries: z.array(LegacyNoteEntrySchema),
  updatedAt: z.string(),
});

export type PersistedNoteRecord = z.infer<typeof NoteRecordSchema>;

export interface CreateNoteInput {
  projectId: string;
  text: string;
  title?: string | null;
  comment?: string | null;
  source?: { workspaceId?: string | null; agentId?: string | null };
}

export interface UpdateNoteInput {
  projectId: string;
  noteId: string;
  title?: string | null;
  text?: string;
  comment?: string | null;
}

function sanitizeProjectId(projectId: string): string {
  const sanitized = projectId.replace(/[^A-Za-z0-9_-]/g, "-");
  return sanitized.length > 0 ? sanitized : "project";
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class NoteStore {
  private readonly notesDirectory: string;
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(paseoHome: string) {
    this.notesDirectory = path.join(paseoHome, "notes");
  }

  private filePath(projectId: string): string {
    return path.join(this.notesDirectory, `${sanitizeProjectId(projectId)}.json`);
  }

  /** Every note the daemon holds, newest first. */
  async list(): Promise<PersistedNoteRecord[]> {
    const files = await this.listProjectFiles();
    const notes = files.flatMap((file) => file.notes);
    return notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listForProject(projectId: string): Promise<PersistedNoteRecord[]> {
    return (await this.readProjectFile(projectId))?.notes ?? [];
  }

  async create(input: CreateNoteInput): Promise<PersistedNoteRecord> {
    return this.enqueue(input.projectId, async () => {
      const now = new Date().toISOString();
      const note: PersistedNoteRecord = {
        noteId: `note_${randomUUID()}`,
        projectId: input.projectId,
        title: normalizeText(input.title),
        text: input.text,
        comment: normalizeText(input.comment),
        source: {
          workspaceId: input.source?.workspaceId ?? null,
          agentId: input.source?.agentId ?? null,
        },
        createdAt: now,
        updatedAt: now,
      };
      const existing = await this.readProjectFile(input.projectId);
      await this.writeProjectFile({
        projectId: input.projectId,
        notes: [note, ...(existing?.notes ?? [])],
      });
      return note;
    });
  }

  async update(input: UpdateNoteInput): Promise<PersistedNoteRecord | null> {
    return this.enqueue(input.projectId, async () => {
      const existing = await this.readProjectFile(input.projectId);
      if (!existing) return null;
      const target = existing.notes.find((note) => note.noteId === input.noteId);
      if (!target) return null;

      const updated: PersistedNoteRecord = {
        ...target,
        title: input.title === undefined ? target.title : normalizeText(input.title),
        text: input.text === undefined ? target.text : input.text,
        comment: input.comment === undefined ? target.comment : normalizeText(input.comment),
        updatedAt: new Date().toISOString(),
      };
      await this.writeProjectFile({
        projectId: input.projectId,
        notes: existing.notes.map((note) => (note.noteId === input.noteId ? updated : note)),
      });
      return updated;
    });
  }

  async delete(input: { projectId: string; noteId: string }): Promise<boolean> {
    return this.enqueue(input.projectId, async () => {
      const existing = await this.readProjectFile(input.projectId);
      if (!existing) return false;
      const notes = existing.notes.filter((note) => note.noteId !== input.noteId);
      if (notes.length === existing.notes.length) return false;
      if (notes.length === 0) {
        await this.deleteProjectFile(input.projectId);
        return true;
      }
      await this.writeProjectFile({ projectId: input.projectId, notes });
      return true;
    });
  }

  private async readProjectFile(
    projectId: string,
  ): Promise<{ projectId: string; notes: PersistedNoteRecord[] } | null> {
    return this.parseProjectFile(projectId, await this.readRaw(projectId));
  }

  private async listProjectFiles(): Promise<
    Array<{ projectId: string; notes: PersistedNoteRecord[] }>
  > {
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(this.notesDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const files = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName) => {
          try {
            const raw = await fs.readFile(path.join(this.notesDirectory, fileName), "utf8");
            const parsed = JSON.parse(raw) as { projectId?: unknown };
            const projectId = typeof parsed?.projectId === "string" ? parsed.projectId : null;
            if (!projectId) return null;
            return this.parseProjectFile(projectId, parsed);
          } catch {
            return null;
          }
        }),
    );
    return files.filter(
      (file): file is { projectId: string; notes: PersistedNoteRecord[] } => file !== null,
    );
  }

  private parseProjectFile(
    projectId: string,
    parsed: unknown,
  ): { projectId: string; notes: PersistedNoteRecord[] } | null {
    const current = ProjectNotesFileSchema.safeParse(parsed);
    if (current.success && current.data.projectId === projectId) {
      return {
        projectId,
        notes: current.data.notes.filter((note) => note.projectId === projectId),
      };
    }
    return this.normalizeLegacyFile(projectId, parsed);
  }

  private normalizeLegacyFile(
    projectId: string,
    parsed: unknown,
  ): { projectId: string; notes: PersistedNoteRecord[] } | null {
    const legacy = LegacyProjectNotesFileSchema.safeParse(parsed);
    if (!legacy.success || legacy.data.projectId !== projectId) return null;

    // Each captured entry becomes one note. A body that was folded from those
    // entries is their organized copy, so it is dropped rather than duplicated;
    // a body with no entries is the only record of what the user had.
    const notes: PersistedNoteRecord[] = legacy.data.entries.map((entry) => ({
      noteId: entry.entryId,
      projectId,
      title: null,
      text: entry.text,
      comment: entry.comment,
      source: entry.source,
      createdAt: entry.createdAt,
      updatedAt: entry.organizedAt ?? entry.createdAt,
    }));
    const body = legacy.data.body.trim();
    if (notes.length === 0 && body.length > 0) {
      notes.push({
        noteId: `note_${randomUUID()}`,
        projectId,
        title: null,
        text: body,
        comment: null,
        source: { workspaceId: null, agentId: null },
        createdAt: legacy.data.bodyUpdatedAt ?? legacy.data.updatedAt,
        updatedAt: legacy.data.updatedAt,
      });
    }
    return { projectId, notes };
  }

  private async readRaw(projectId: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(projectId), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeProjectFile(file: {
    projectId: string;
    notes: PersistedNoteRecord[];
  }): Promise<void> {
    await writeJsonFileAtomic(this.filePath(file.projectId), {
      projectId: file.projectId,
      notes: file.notes,
    });
  }

  private async deleteProjectFile(projectId: string): Promise<void> {
    try {
      await fs.rm(this.filePath(projectId), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  /**
   * Read-modify-write behind a per-project chain so two devices writing at once
   * cannot drop one another's notes. The write itself is atomic; the chain is
   * what keeps the read half honest.
   */
  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const tail = next.catch(() => undefined);
    this.writeChains.set(projectId, tail);
    void tail.finally(() => {
      if (this.writeChains.get(projectId) === tail) {
        this.writeChains.delete(projectId);
      }
    });
    return next;
  }
}

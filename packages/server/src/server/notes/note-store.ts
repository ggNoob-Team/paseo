import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NoteProjectPayload } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

/**
 * One project has one note, stored beside the registries it points at:
 * `$PASEO_HOME/notes/{projectId}.json`. Notes outlive the project they belong
 * to — archiving or removing a project never deletes the note — so the file is
 * keyed by the stable `projectId`, not by name or root path.
 */
const PersistedNoteEntrySchema = z.object({
  entryId: z.string().min(1),
  createdAt: z.string(),
  text: z.string(),
  comment: z.string().nullable(),
  source: z.object({
    workspaceId: z.string().nullable(),
    agentId: z.string().nullable(),
  }),
  organizedAt: z.string().nullable(),
});

const PersistedNoteSchema = z.object({
  projectId: z.string().min(1),
  body: z.string(),
  bodyUpdatedAt: z.string().nullable(),
  entries: z.array(PersistedNoteEntrySchema),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PersistedNote = z.infer<typeof PersistedNoteSchema>;
export type PersistedNoteEntry = z.infer<typeof PersistedNoteEntrySchema>;

export interface AppendNoteEntryInput {
  projectId: string;
  text: string;
  comment?: string | null;
  source?: { workspaceId?: string | null; agentId?: string | null };
}

function sanitizeProjectId(projectId: string): string {
  const sanitized = projectId.replace(/[^A-Za-z0-9_-]/g, "-");
  return sanitized.length > 0 ? sanitized : "project";
}

/**
 * File per project, read on demand. Notes are small and few, and the daemon
 * already keeps the whole project registry in memory; caching here would only
 * add a way for the file and the cache to disagree.
 */
export class NoteStore {
  private readonly notesDirectory: string;
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(paseoHome: string) {
    this.notesDirectory = path.join(paseoHome, "notes");
  }

  private filePath(projectId: string): string {
    return path.join(this.notesDirectory, `${sanitizeProjectId(projectId)}.json`);
  }

  async get(projectId: string): Promise<PersistedNote | null> {
    try {
      const raw = await fs.readFile(this.filePath(projectId), "utf8");
      const parsed = PersistedNoteSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.projectId !== projectId) {
        return null;
      }
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async list(): Promise<PersistedNote[]> {
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(this.notesDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const notes = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName) => {
          try {
            const raw = await fs.readFile(path.join(this.notesDirectory, fileName), "utf8");
            const parsed = PersistedNoteSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
          } catch {
            return null;
          }
        }),
    );
    return notes.filter((note): note is PersistedNote => note !== null);
  }

  /**
   * Read-modify-write behind a per-project chain so two appends racing from two
   * devices cannot drop one. The write itself is atomic; the chain is what keeps
   * the read half honest.
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

  async appendEntry(input: AppendNoteEntryInput): Promise<PersistedNote> {
    return this.enqueue(input.projectId, async () => {
      const now = new Date().toISOString();
      const existing = await this.get(input.projectId);
      const entry: PersistedNoteEntry = {
        entryId: `note_entry_${randomUUID()}`,
        createdAt: now,
        text: input.text,
        comment: input.comment?.trim() ? input.comment.trim() : null,
        source: {
          workspaceId: input.source?.workspaceId ?? null,
          agentId: input.source?.agentId ?? null,
        },
        organizedAt: null,
      };
      const note: PersistedNote = existing
        ? {
            ...existing,
            entries: [...existing.entries, entry],
            updatedAt: now,
          }
        : {
            projectId: input.projectId,
            body: "",
            bodyUpdatedAt: null,
            entries: [entry],
            lastError: null,
            createdAt: now,
            updatedAt: now,
          };
      await this.write(note);
      return note;
    });
  }

  async setBody(input: { projectId: string; body: string }): Promise<PersistedNote | null> {
    return this.enqueue(input.projectId, async () => {
      const existing = await this.get(input.projectId);
      if (!existing) return null;
      const now = new Date().toISOString();
      const note: PersistedNote = {
        ...existing,
        body: input.body,
        bodyUpdatedAt: now,
        updatedAt: now,
      };
      await this.write(note);
      return note;
    });
  }

  async deleteEntry(input: { projectId: string; entryId: string }): Promise<PersistedNote | null> {
    return this.enqueue(input.projectId, async () => {
      const existing = await this.get(input.projectId);
      if (!existing) return null;
      const entries = existing.entries.filter((entry) => entry.entryId !== input.entryId);
      if (entries.length === existing.entries.length) {
        return existing;
      }
      const now = new Date().toISOString();
      const note: PersistedNote = { ...existing, entries, updatedAt: now };
      await this.write(note);
      return note;
    });
  }

  /** Writes the result of one generation run: the new body and the entries it folded in. */
  async applyGeneration(input: {
    projectId: string;
    body: string;
    organizedEntryIds: readonly string[];
    generatedAt: string;
  }): Promise<PersistedNote | null> {
    return this.enqueue(input.projectId, async () => {
      const existing = await this.get(input.projectId);
      if (!existing) return null;
      const organized = new Set(input.organizedEntryIds);
      const entries: PersistedNoteEntry[] = [];
      for (const entry of existing.entries) {
        if (!organized.has(entry.entryId) || entry.organizedAt === input.generatedAt) {
          entries.push(entry);
          continue;
        }
        // Copy-on-write: the previous note object may still be referenced by a
        // caller that read it before this run finished.
        const folded = Object.assign({}, entry);
        folded.organizedAt = input.generatedAt;
        entries.push(folded);
      }
      const note: PersistedNote = {
        ...existing,
        body: input.body,
        bodyUpdatedAt: input.generatedAt,
        entries,
        lastError: null,
        updatedAt: input.generatedAt,
      };
      await this.write(note);
      return note;
    });
  }

  async recordGenerationError(input: {
    projectId: string;
    error: string;
  }): Promise<PersistedNote | null> {
    return this.enqueue(input.projectId, async () => {
      const existing = await this.get(input.projectId);
      if (!existing) return null;
      const note: PersistedNote = {
        ...existing,
        lastError: input.error,
        updatedAt: new Date().toISOString(),
      };
      await this.write(note);
      return note;
    });
  }

  private async write(note: PersistedNote): Promise<void> {
    await writeJsonFileAtomic(this.filePath(note.projectId), note);
  }
}

/** Wire shape for a stored note, with the project's current display name attached. */
export function toNoteProjectPayload(note: PersistedNote, projectName: string): NoteProjectPayload {
  return {
    projectId: note.projectId,
    projectName,
    body: note.body,
    bodyUpdatedAt: note.bodyUpdatedAt,
    entries: note.entries.map((entry) => ({
      entryId: entry.entryId,
      createdAt: entry.createdAt,
      text: entry.text,
      comment: entry.comment,
      source: entry.source,
      organizedAt: entry.organizedAt,
    })),
    lastError: note.lastError,
    updatedAt: note.updatedAt,
  };
}

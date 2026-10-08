import type { NoteRecordPayload } from "@getpaseo/protocol/messages";

export interface HostNote extends NoteRecordPayload {
  serverId: string;
  hostLabel: string;
}

/**
 * Every note the connected hosts hold, newest first. The project it belongs to
 * is shown beside it rather than used to group it: a note is its own thing now.
 */
export function mergeNotes(notes: readonly HostNote[]): HostNote[] {
  return [...notes].sort(compareNotes);
}

export function compareNotes(left: HostNote, right: HostNote): number {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  if (byUpdatedAt !== 0) return byUpdatedAt;
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  if (left.serverId !== right.serverId) return left.serverId.localeCompare(right.serverId);
  return left.noteId.localeCompare(right.noteId);
}

/** Title when the user gave one; the first line of the text otherwise. */
export function noteDisplayTitle(note: Pick<NoteRecordPayload, "title" | "text">): string {
  const title = note.title?.trim();
  if (title) return title;
  const firstLine = note.text.trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length > 0 ? firstLine : note.text.trim();
}

export function findNoteById(notes: readonly HostNote[], noteId: string | null): HostNote | null {
  if (!noteId) return null;
  return notes.find((note) => note.noteId === noteId) ?? null;
}

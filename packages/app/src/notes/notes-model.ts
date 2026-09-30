import type { NoteProjectPayload, NoteProjectSummaryPayload } from "@getpaseo/protocol/messages";

export interface HostProjectNoteSummary extends NoteProjectSummaryPayload {
  serverId: string;
  hostLabel: string;
}

export interface ProjectNoteView extends NoteProjectPayload {
  serverId: string;
  hostLabel: string;
}

/**
 * Which projects have notes, newest first. A project with an unorganized entry
 * leads its timestamp: the note changed when the user captured something, and
 * that is the moment they will look for.
 */
export function mergeProjectNoteSummaries(
  summaries: readonly HostProjectNoteSummary[],
): HostProjectNoteSummary[] {
  return [...summaries].sort((left, right) => {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    const byProject = left.projectName.localeCompare(right.projectName);
    if (byProject !== 0) return byProject;
    return left.serverId.localeCompare(right.serverId);
  });
}

export function countPendingNoteEntries(note: NoteProjectPayload | null | undefined): number {
  if (!note) return 0;
  return note.entries.filter((entry) => entry.organizedAt === null).length;
}

export type NoteGenerationState = "idle" | "organizing" | "failed";

/**
 * A note is "organizing" while any entry has not been folded into the body yet.
 * `lastError` only owns the state once there is nothing left to fold in: an
 * error recorded by an older run must not mask work that is still queued.
 */
export function resolveNoteGenerationState(
  note: NoteProjectPayload | null | undefined,
): NoteGenerationState {
  if (!note) return "idle";
  if (countPendingNoteEntries(note) > 0) return "organizing";
  return note.lastError ? "failed" : "idle";
}

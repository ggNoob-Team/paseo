import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NoteRecordPayload } from "@getpaseo/protocol/messages";
import { useFetchQueries } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { mergeNotes, type HostNote } from "./notes-model";

/**
 * Notes change when the user acts, and every response carries the note it
 * wrote, so the cache only has to survive incidental remounts.
 */
const NOTES_STALE_TIME_MS = 15_000;

export function notesListQueryKey(serverId: string) {
  return ["notes", serverId, "list"] as const;
}

export interface NotesHost {
  serverId: string;
  hostLabel: string;
  supportsNotes: boolean;
}

/**
 * Hosts that advertise the notes capability. An older daemon keeps its place in
 * the list with `supportsNotes: false` so the notes screens can say which host
 * needs an update instead of silently showing nothing for it.
 */
export function useNotesHosts(): NotesHost[] {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supportsByServerId = useHostFeatureMap(serverIds, "notesPerEntry");
  return useMemo(
    () =>
      hosts.map((host) => ({
        serverId: host.serverId,
        hostLabel: host.label.trim() || host.serverId,
        supportsNotes: supportsByServerId.get(host.serverId) === true,
      })),
    [hosts, supportsByServerId],
  );
}

export interface NotesListResult {
  notes: HostNote[];
  isLoading: boolean;
  unsupportedHostLabels: string[];
  refresh: () => void;
}

export function useNotesList(): NotesListResult {
  const hosts = useNotesHosts();
  const supportedHosts = useMemo(() => hosts.filter((host) => host.supportsNotes), [hosts]);
  const queries = useFetchQueries(
    supportedHosts.map((host) => ({
      queryKey: notesListQueryKey(host.serverId),
      dataShape: "list" as const,
      staleTimeMs: NOTES_STALE_TIME_MS,
      queryFn: async () => {
        const client = getHostRuntimeStore().getClient(host.serverId);
        if (!client) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
        return client.listNotes();
      },
    })),
  );

  const unsupportedHostLabels = useMemo(
    () => hosts.filter((host) => !host.supportsNotes).map((host) => host.hostLabel),
    [hosts],
  );

  const notes = useMemo(() => {
    const rows: HostNote[] = [];
    supportedHosts.forEach((host, index) => {
      const data = queries[index]?.data;
      if (!data) return;
      for (const note of data) {
        rows.push({ ...note, serverId: host.serverId, hostLabel: host.hostLabel });
      }
    });
    return mergeNotes(rows);
  }, [queries, supportedHosts]);

  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    for (const host of supportedHosts) {
      void queryClient.invalidateQueries({ queryKey: notesListQueryKey(host.serverId) });
    }
  }, [queryClient, supportedHosts]);

  return {
    notes,
    isLoading: supportedHosts.length > 0 && queries.some((query) => query.isLoading),
    unsupportedHostLabels,
    refresh,
  };
}

export interface NoteActions {
  createNote: (input: {
    projectId: string;
    text: string;
    title?: string | null;
    comment?: string | null;
    source?: { workspaceId: string | null; agentId: string | null };
  }) => Promise<NoteRecordPayload>;
  updateNote: (
    note: HostNote,
    input: { title?: string | null; text?: string; comment?: string | null },
  ) => Promise<NoteRecordPayload | null>;
  deleteNote: (note: HostNote) => Promise<void>;
}

/** Writes go through the list cache the screens read, so they land immediately. */
export function useNoteActions(serverId: string | null): NoteActions {
  const queryClient = useQueryClient();

  const applyNote = useCallback(
    (note: NoteRecordPayload) => {
      if (!serverId) return;
      queryClient.setQueryData<NoteRecordPayload[]>(notesListQueryKey(serverId), (current) => {
        const existing = current ?? [];
        const index = existing.findIndex((entry) => entry.noteId === note.noteId);
        if (index < 0) return [note, ...existing];
        return existing.map((entry) => (entry.noteId === note.noteId ? note : entry));
      });
    },
    [queryClient, serverId],
  );

  const requireClient = useCallback(() => {
    const client = serverId ? getHostRuntimeStore().getClient(serverId) : null;
    if (!client) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    return client;
  }, [serverId]);

  const createMutation = useMutation({
    mutationFn: async (input: {
      projectId: string;
      text: string;
      title?: string | null;
      comment?: string | null;
      source?: { workspaceId: string | null; agentId: string | null };
    }) => requireClient().createNote(input),
    onSuccess: applyNote,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      note: HostNote;
      title?: string | null;
      text?: string;
      comment?: string | null;
    }) =>
      requireClient().updateNote({
        noteId: input.note.noteId,
        projectId: input.note.projectId,
        title: input.title,
        text: input.text,
        comment: input.comment,
      }),
    onSuccess: (note) => {
      if (note) applyNote(note);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (note: HostNote) =>
      requireClient().deleteNote({ noteId: note.noteId, projectId: note.projectId }),
    onSuccess: (deleted, note) => {
      if (!serverId || !deleted) return;
      queryClient.setQueryData<NoteRecordPayload[]>(notesListQueryKey(serverId), (current) =>
        (current ?? []).filter((entry) => entry.noteId !== note.noteId),
      );
    },
  });

  return {
    createNote: (input) => createMutation.mutateAsync(input),
    updateNote: (note, input) => updateMutation.mutateAsync({ note, ...input }),
    deleteNote: async (note) => {
      await deleteMutation.mutateAsync(note);
    },
  };
}

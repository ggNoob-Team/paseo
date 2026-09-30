import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQueries, useFetchQuery } from "@/data/query";
import type { NoteProjectPayload } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import {
  mergeProjectNoteSummaries,
  type HostProjectNoteSummary,
  type ProjectNoteView,
} from "./notes-model";

/**
 * Notes change on the user's own actions and on a background push, so the cache
 * only has to survive incidental remounts — not wait out a TTL to see new work.
 */
const NOTES_STALE_TIME_MS = 15_000;

export function notesListQueryKey(serverId: string) {
  return ["notes", serverId, "list"] as const;
}

export function noteQueryKey(serverId: string, projectId: string) {
  return ["notes", serverId, "project", projectId] as const;
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
  const supportsByServerId = useHostFeatureMap(serverIds, "notes");
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

export interface ProjectNotesListResult {
  notes: HostProjectNoteSummary[];
  isLoading: boolean;
  unsupportedHostLabels: string[];
  refresh: () => void;
}

export function useProjectNotesList(): ProjectNotesListResult {
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
        return client.listProjectNotes();
      },
    })),
  );

  const unsupportedHostLabels = useMemo(
    () => hosts.filter((host) => !host.supportsNotes).map((host) => host.hostLabel),
    [hosts],
  );

  const notes = useMemo(() => {
    const rows: HostProjectNoteSummary[] = [];
    supportedHosts.forEach((host, index) => {
      const data = queries[index]?.data;
      if (!data) return;
      for (const summary of data) {
        rows.push({ ...summary, serverId: host.serverId, hostLabel: host.hostLabel });
      }
    });
    return mergeProjectNoteSummaries(rows);
  }, [queries, supportedHosts]);

  const client = useQueryClient();
  const refresh = useCallback(() => {
    for (const host of supportedHosts) {
      void client.invalidateQueries({ queryKey: notesListQueryKey(host.serverId) });
    }
  }, [client, supportedHosts]);

  return {
    notes,
    isLoading: supportedHosts.length > 0 && queries.some((query) => query.isLoading),
    unsupportedHostLabels,
    refresh,
  };
}

export interface ProjectNoteResult {
  note: ProjectNoteView | null;
  isLoading: boolean;
  error: string | null;
  appendEntry: (input: {
    text: string;
    comment?: string | null;
    agentId?: string | null;
  }) => Promise<void>;
  updateBody: (body: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
}

export function useProjectNote(input: {
  serverId: string | null;
  projectId: string | null;
}): ProjectNoteResult {
  const { serverId, projectId } = input;
  const queryClient = useQueryClient();
  const hostLabel = useHosts().find((host) => host.serverId === serverId)?.label ?? "";
  const enabled = Boolean(serverId && projectId);

  const query = useFetchQuery({
    queryKey: noteQueryKey(serverId ?? "", projectId ?? ""),
    enabled,
    dataShape: "value",
    staleTimeMs: NOTES_STALE_TIME_MS,
    queryFn: async (): Promise<NoteProjectPayload | null> => {
      const client = serverId ? getHostRuntimeStore().getClient(serverId) : null;
      if (!client || !projectId) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
      return client.getProjectNote({ projectId });
    },
  });

  const applyNote = useCallback(
    (note: NoteProjectPayload | null) => {
      if (!serverId || !projectId) return;
      queryClient.setQueryData(noteQueryKey(serverId, projectId), note);
      void queryClient.invalidateQueries({ queryKey: notesListQueryKey(serverId) });
    },
    [projectId, queryClient, serverId],
  );

  const appendMutation = useMutation({
    mutationFn: async (entry: {
      text: string;
      comment?: string | null;
      agentId?: string | null;
    }) => {
      const client = serverId ? getHostRuntimeStore().getClient(serverId) : null;
      if (!client || !projectId) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
      return client.appendNoteEntry({
        projectId,
        text: entry.text,
        comment: entry.comment ?? null,
        source: { workspaceId: null, agentId: entry.agentId ?? null },
      });
    },
    onSuccess: applyNote,
  });
  const updateMutation = useMutation({
    mutationFn: async (body: string) => {
      const client = serverId ? getHostRuntimeStore().getClient(serverId) : null;
      if (!client || !projectId) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
      return client.updateProjectNote({ projectId, body });
    },
    onSuccess: applyNote,
  });
  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const client = serverId ? getHostRuntimeStore().getClient(serverId) : null;
      if (!client || !projectId) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
      return client.deleteNoteEntry({ projectId, entryId });
    },
    onSuccess: applyNote,
  });

  useNoteUpdatesSubscription(serverId ? [serverId] : []);

  const note = useMemo<ProjectNoteView | null>(
    () => (query.data ? { ...query.data, serverId: serverId ?? "", hostLabel } : null),
    [hostLabel, query.data, serverId],
  );

  return {
    note,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    appendEntry: async (entry) => {
      await appendMutation.mutateAsync(entry);
    },
    updateBody: async (body) => {
      await updateMutation.mutateAsync(body);
    },
    deleteEntry: async (entryId) => {
      await deleteMutation.mutateAsync(entryId);
    },
  };
}

/**
 * Background runs finish long after the append they belong to, so the daemon
 * pushes the new note. Writing it straight into the query cache keeps the open
 * note and the list in step without polling.
 */
export function useNoteUpdatesSubscription(serverIds: readonly string[]): void {
  const queryClient = useQueryClient();
  const key = serverIds.join(",");

  useEffect(() => {
    const ids = key.length > 0 ? key.split(",") : [];
    const releases: Array<() => void> = [];
    for (const serverId of ids) {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) continue;
      const subscription = client.observeProjectNotes();
      const unsubscribe = subscription.subscribe({
        snapshot: () => {},
        update: (message) => {
          if (message.type !== "notes.project.updated") return;
          const note = message.payload.note;
          queryClient.setQueryData(noteQueryKey(serverId, note.projectId), note);
          void queryClient.invalidateQueries({ queryKey: notesListQueryKey(serverId) });
        },
      });
      releases.push(() => {
        unsubscribe();
        void subscription.release().catch(() => undefined);
      });
    }
    return () => {
      for (const release of releases) release();
    };
  }, [key, queryClient]);
}

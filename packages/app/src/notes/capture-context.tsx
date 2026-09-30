import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { AddNoteSheet, type AddNoteDraft } from "./add-note-sheet";
import { splitMessageIntoBlocks } from "./message-blocks";

export interface NotesCapture {
  /** Captures plain text — a code fence or a desktop text selection. */
  addText: (text: string) => void;
  /**
   * Captures a whole message. A message with several top-level blocks opens the
   * block picker, because a phone cannot drag a native selection across them.
   */
  addMarkdown: (markdown: string) => void;
}

const NotesCaptureContext = createContext<NotesCapture | null>(null);

/** Last-resort lookup for a workspace whose descriptor has not landed yet. */
function resolveWorkspaceProjectId(
  serverId: string,
  workspaceId: string | undefined,
): string | null {
  if (!workspaceId) return null;
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId });
  if (!workspaceKey) return null;
  return workspaces?.get(workspaceKey)?.projectId ?? null;
}

/** Null outside an agent chat, or before the workspace behind it is known. */
export function useNotesCaptureOptional(): NotesCapture | null {
  return useContext(NotesCaptureContext);
}

/**
 * The bridge between a captured block and the daemon. It owns the sheet so a
 * caller only has to hand over text; the project is resolved from the workspace
 * the agent is running in, which is what makes the note follow the project
 * rather than the agent.
 */
export function NotesCaptureProvider({
  serverId,
  workspaceId,
  agentId,
  children,
}: {
  serverId: string;
  workspaceId?: string;
  agentId?: string;
  children: ReactNode;
}): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const supportsNotes = useHostFeature(serverId, "notes");
  const hosts = useHosts();
  const workspace = useWorkspace(serverId || null, workspaceId ?? null);
  const projectId = workspace?.projectId ?? null;
  const [draft, setDraft] = useState<AddNoteDraft | null>(null);
  const [visible, setVisible] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);

  const hostLabel = useMemo(
    () => hosts.find((host) => host.serverId === serverId)?.label.trim() || serverId,
    [hosts, serverId],
  );

  const appendMutation = useMutation({
    mutationFn: async (input: { text: string; comment: string | null }) => {
      const client = getHostRuntimeStore().getClient(serverId);
      // Resolved again at submit time: the button must not wait for the
      // workspace descriptor, and an agent opened before the directory synced
      // still has to be able to add a note.
      const targetProjectId = projectId ?? resolveWorkspaceProjectId(serverId, workspaceId);
      if (!client || !targetProjectId) {
        throw new Error(t("notes.addEntryFailed"));
      }
      return client.appendNoteEntry({
        projectId: targetProjectId,
        text: input.text,
        comment: input.comment,
        source: { workspaceId: workspaceId ?? null, agentId: agentId ?? null },
      });
    },
  });
  const appendAsync = appendMutation.mutateAsync;

  const openDraft = useCallback(
    (next: { text: string; blocks?: AddNoteDraft["blocks"] }) => {
      const text = next.text.trim();
      if (text.length === 0) return;
      setDraft({
        text,
        blocks: next.blocks,
        projectName: workspace?.projectDisplayName ?? "",
      });
      setCaptureCount((count) => count + 1);
      setVisible(true);
    },
    [workspace?.projectDisplayName],
  );

  const capture = useMemo<NotesCapture>(() => {
    if (!supportsNotes) {
      // The host cannot store notes yet. Saying so beats hiding the action: a
      // missing button reads as a missing feature, and the fix is an update on
      // the host rather than anything the client can do.
      const explainUnsupportedHost = () => {
        toast.show(t("notes.hostUpgrade", { host: hostLabel }), { variant: "warning" });
      };
      return { addText: explainUnsupportedHost, addMarkdown: explainUnsupportedHost };
    }
    return {
      addText: (text: string) => openDraft({ text }),
      addMarkdown: (markdown: string) => {
        const blocks = splitMessageIntoBlocks(markdown);
        if (blocks.length === 0) return;
        openDraft({
          text: blocks.map((block) => block.text).join("\n\n"),
          blocks: blocks.length > 1 ? blocks : undefined,
        });
      },
    };
  }, [hostLabel, openDraft, supportsNotes, t, toast]);

  const handleClose = useCallback(() => setVisible(false), []);

  const handleSubmit = useCallback(
    async (input: { text: string; comment: string | null }) => {
      await appendAsync({ text: input.text, comment: input.comment });
      toast.show(t("notes.addEntrySaved"), { variant: "success" });
    },
    [appendAsync, t, toast],
  );

  // An agent with no workspace has no project to file a note under, and no
  // amount of retrying changes that.
  if (!workspaceId) {
    return children;
  }

  return (
    <NotesCaptureContext.Provider value={capture}>
      {children}
      <AddNoteSheet
        visible={visible}
        draft={draft}
        resetKey={captureCount}
        onClose={handleClose}
        onSubmit={handleSubmit}
      />
    </NotesCaptureContext.Provider>
  );
}

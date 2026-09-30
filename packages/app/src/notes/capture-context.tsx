import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { AddNoteSheet, type AddNoteDraft } from "./add-note-sheet";

export interface NotesCapture {
  /** Opens the confirmation sheet for a captured block of text. */
  addText: (text: string) => void;
}

const NotesCaptureContext = createContext<NotesCapture | null>(null);

/** Null outside an agent chat (or on a host that cannot store notes). */
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
  const workspace = useWorkspace(serverId || null, workspaceId ?? null);
  const projectId = workspace?.projectId ?? null;
  const [draft, setDraft] = useState<AddNoteDraft | null>(null);
  const [visible, setVisible] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);

  const appendMutation = useMutation({
    mutationFn: async (input: { text: string; comment: string | null }) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client || !projectId) {
        throw new Error(t("notes.addEntryFailed"));
      }
      return client.appendNoteEntry({
        projectId,
        text: input.text,
        comment: input.comment,
        source: { workspaceId: workspaceId ?? null, agentId: agentId ?? null },
      });
    },
  });
  const appendAsync = appendMutation.mutateAsync;

  const addText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || !projectId) return;
      setDraft({
        text: trimmed,
        projectName: workspace?.projectDisplayName ?? "",
      });
      setCaptureCount((count) => count + 1);
      setVisible(true);
    },
    [projectId, workspace?.projectDisplayName],
  );

  const capture = useMemo<NotesCapture>(() => ({ addText }), [addText]);
  const handleClose = useCallback(() => setVisible(false), []);

  const handleSubmit = useCallback(
    async (input: { comment: string | null }) => {
      if (!draft) return;
      await appendAsync({ text: draft.text, comment: input.comment });
      toast.show(t("notes.addEntrySaved"), { variant: "success" });
    },
    [appendAsync, draft, t, toast],
  );

  if (!supportsNotes || !projectId) {
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

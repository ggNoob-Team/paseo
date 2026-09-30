import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { NotebookPen, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useToast } from "@/contexts/toast-context";
import { resolveNoteGenerationState } from "@/notes/notes-model";
import { useProjectNote, type ProjectNoteResult } from "@/notes/use-notes";
import type { Theme } from "@/styles/theme";
import type { NoteEntryPayload } from "@getpaseo/protocol/messages";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedNotebookPen = withUnistyles(NotebookPen);
const ThemedTrash = withUnistyles(Trash2);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function NoteDetailScreen(): ReactElement {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ projectId?: string; server?: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : null;
  const serverId = typeof params.server === "string" ? params.server : null;
  const noteState = useProjectNote({ serverId, projectId });
  const [isEditing, setIsEditing] = useState(false);
  const title = noteState.note?.projectName ?? t("notes.title");
  const handleStartEditing = useCallback(() => setIsEditing(true), []);
  const handleFinishEditing = useCallback(() => setIsEditing(false), []);
  const headerActions = useMemo(
    () =>
      noteState.note && !isEditing ? (
        <Button variant="secondary" size="sm" onPress={handleStartEditing} testID="note-edit">
          {t("notes.editBody")}
        </Button>
      ) : null,
    [handleStartEditing, isEditing, noteState.note, t],
  );

  let body: ReactElement;
  if (noteState.isLoading) {
    body = (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (noteState.error) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.emptyDescription}>{noteState.error}</Text>
      </View>
    );
  } else {
    body = (
      <NoteDetailContent
        noteState={noteState}
        isEditing={isEditing}
        onFinishEditing={handleFinishEditing}
      />
    );
  }

  return (
    <View style={styles.container} testID="note-detail-screen">
      <MenuHeader title={title} rightContent={headerActions} />
      {body}
    </View>
  );
}

function NoteDetailContent({
  noteState,
  isEditing,
  onFinishEditing,
}: {
  noteState: ProjectNoteResult;
  isEditing: boolean;
  onFinishEditing: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const note = noteState.note;
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraft(note?.body ?? "");
    }
  }, [isEditing, note?.body]);

  const handleChangeDraft = useCallback((value: string) => setDraft(value), []);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      await noteState.updateBody(draft);
      toast.show(t("notes.bodySaved"), { variant: "success" });
      onFinishEditing();
    } catch {
      toast.error(t("notes.bodySaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [draft, noteState, onFinishEditing, t, toast]);

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      try {
        await noteState.deleteEntry(entryId);
      } catch {
        toast.error(t("notes.deleteEntryFailed"));
      }
    },
    [noteState, t, toast],
  );

  const entries = note?.entries ?? [];
  const generationState = resolveNoteGenerationState(note);

  return (
    <ScrollView contentContainerStyle={styles.content} testID="note-detail-scroll">
      <NoteStatusLine state={generationState} lastError={note?.lastError ?? null} />
      {isEditing ? (
        <NoteBodyEditor
          initialBody={note?.body ?? ""}
          isSaving={isSaving}
          onChangeText={handleChangeDraft}
          onCancel={onFinishEditing}
          onSave={handleSave}
        />
      ) : (
        <NoteBodyView body={note?.body ?? ""} />
      )}
      <Text style={styles.sectionTitle}>{t("notes.entriesTitle")}</Text>
      {entries.length === 0 ? (
        <Text style={styles.emptyBody}>{t("notes.entriesEmpty")}</Text>
      ) : (
        entries.map((entry) => (
          <NoteEntryRow key={entry.entryId} entry={entry} onDelete={handleDeleteEntry} />
        ))
      )}
    </ScrollView>
  );
}

function NoteStatusLine({
  state,
  lastError,
}: {
  state: ReturnType<typeof resolveNoteGenerationState>;
  lastError: string | null;
}): ReactElement {
  const { t } = useTranslation();
  let label: string;
  if (state === "organizing") {
    label = t("notes.organizing");
  } else if (state === "failed") {
    label = lastError ?? t("notes.failed");
  } else {
    label = t("notes.organizedHint");
  }

  return (
    <View style={styles.statusRow}>
      <ThemedNotebookPen size={16} uniProps={mutedColorMapping} />
      <View style={styles.statusTextGroup}>
        <Text style={styles.statusText}>{label}</Text>
        {state === "failed" && lastError ? (
          <Text style={styles.statusDetail} testID="note-status-detail">
            {lastError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function NoteBodyView({ body }: { body: string }): ReactElement {
  const { t } = useTranslation();
  if (body.trim().length === 0) {
    return <Text style={styles.emptyBody}>{t("notes.bodyEmpty")}</Text>;
  }
  return <MarkdownRenderer text={body} />;
}

function NoteBodyEditor({
  initialBody,
  isSaving,
  onChangeText,
  onCancel,
  onSave,
}: {
  initialBody: string;
  isSaving: boolean;
  onChangeText: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [resetKey] = useState(() => Date.now());

  return (
    <View style={styles.editor}>
      <AdaptiveTextInput
        initialValue={initialBody}
        resetKey={resetKey}
        onChangeText={onChangeText}
        multiline
        editable={!isSaving}
        style={styles.editorInput}
        testID="note-body-input"
      />
      <View style={styles.editorActions}>
        <Button
          variant="secondary"
          size="sm"
          style={styles.editorButton}
          onPress={onCancel}
          disabled={isSaving}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          style={styles.editorButton}
          onPress={onSave}
          disabled={isSaving}
          testID="note-body-save"
        >
          {t("notes.saveBody")}
        </Button>
      </View>
    </View>
  );
}

function NoteEntryRow({
  entry,
  onDelete,
}: {
  entry: NoteEntryPayload;
  onDelete: (entryId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const timeLabel = useCompactTimeAgo(new Date(entry.createdAt));
  const [expanded, setExpanded] = useState(false);
  const preview = expanded ? entry.text : entry.text.slice(0, 240);
  const organizedMark = entry.organizedAt ? "✓" : "…";

  const handleDelete = useCallback(() => onDelete(entry.entryId), [entry.entryId, onDelete]);
  const handleToggleExpanded = useCallback(() => setExpanded((value) => !value), []);

  return (
    <View style={styles.entry} testID={`note-entry-${entry.entryId}`}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryTime}>
          {timeLabel} · {organizedMark}
        </Text>
        <Pressable
          onPress={handleDelete}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("notes.deleteEntry")}
          testID={`note-entry-delete-${entry.entryId}`}
        >
          <ThemedTrash size={16} uniProps={mutedColorMapping} />
        </Pressable>
      </View>
      <Pressable onPress={handleToggleExpanded}>
        <Text style={styles.entryText}>{preview}</Text>
      </Pressable>
      {entry.comment ? <Text style={styles.entryComment}>{entry.comment}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  content: {
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[8],
    },
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[3],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  statusDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.8,
  },
  emptyBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  editor: {
    gap: theme.spacing[2],
  },
  editorInput: {
    minHeight: 200,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  editorActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  editorButton: {
    flex: 1,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    marginTop: theme.spacing[4],
  },
  entry: {
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  entryTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  entryText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  entryComment: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
}));

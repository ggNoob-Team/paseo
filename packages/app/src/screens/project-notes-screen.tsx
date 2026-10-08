import { useCallback, useMemo, type ReactElement } from "react";
import { FlatList, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { StackScreenHeader } from "@/components/headers/stack-screen-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AddNoteButton } from "@/notes/add-note-button";
import { NotesCaptureProvider } from "@/notes/capture-context";
import { NoteListRow } from "@/notes/note-list-row";
import type { HostNote } from "@/notes/notes-model";
import { useNotesList } from "@/notes/use-notes";
import type { Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

/**
 * One project's notes, opened from the workspace header. "Add note" lives here
 * rather than in the header itself, so the clipboard capture flow starts from
 * the list the note will land in.
 */
export function ProjectNotesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <ProjectNotesScreenContent />;
}

function ProjectNotesScreenContent(): ReactElement {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ projectId?: string; server?: string; name?: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : null;
  const serverId = typeof params.server === "string" ? params.server : null;
  const projectName = typeof params.name === "string" ? params.name : "";
  const { notes, isLoading, refresh } = useNotesList();

  const projectNotes = useMemo(
    () =>
      serverId && projectId
        ? notes.filter((note) => note.serverId === serverId && note.projectId === projectId)
        : [],
    [notes, projectId, serverId],
  );

  const renderItem = useCallback(({ item }: { item: HostNote }) => <NoteListRow note={item} />, []);

  let body: ReactElement;
  if (isLoading) {
    body = (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (projectNotes.length === 0) {
    body = (
      <View style={styles.centered} testID="project-notes-empty">
        <Text style={styles.emptyTitle}>{t("notes.projectEmptyTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("notes.projectEmptyDescription")}</Text>
        <AddNoteButton variant="secondary" />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={projectNotes}
        keyExtractor={projectNoteKey}
        renderItem={renderItem}
        onRefresh={refresh}
        refreshing={false}
        contentContainerStyle={styles.listContent}
        testID="project-notes-list"
      />
    );
  }

  const headerTitle = projectName || t("notes.title");
  const headerActions = useMemo(() => <AddNoteButton />, []);
  if (!serverId || !projectId) {
    return (
      <View style={styles.container} testID="project-notes-screen">
        <StackScreenHeader title={headerTitle} />
        {body}
      </View>
    );
  }

  return (
    <NotesCaptureProvider serverId={serverId} projectId={projectId}>
      <View style={styles.container} testID="project-notes-screen">
        <StackScreenHeader title={headerTitle} rightContent={headerActions} />
        {body}
      </View>
    </NotesCaptureProvider>
  );
}

function projectNoteKey(note: HostNote): string {
  return `${note.serverId}:${note.noteId}`;
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
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    maxWidth: 420,
  },
  listContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingBottom: theme.spacing[6],
  },
}));

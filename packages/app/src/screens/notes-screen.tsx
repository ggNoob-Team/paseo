import { useCallback, type ReactElement } from "react";
import { FlatList, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { StackScreenHeader } from "@/components/headers/stack-screen-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoteListRow } from "@/notes/note-list-row";
import type { HostNote } from "@/notes/notes-model";
import { useNotesList } from "@/notes/use-notes";
import type { Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function NotesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <NotesScreenContent />;
}

function NotesScreenContent(): ReactElement {
  const { t } = useTranslation();
  const { notes, isLoading, unsupportedHostLabels, refresh } = useNotesList();

  const renderItem = useCallback(({ item }: { item: HostNote }) => <NoteListRow note={item} />, []);

  let body: ReactElement;
  if (isLoading) {
    body = (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (notes.length === 0) {
    body = (
      <View style={styles.centered} testID="notes-empty">
        <Text style={styles.emptyTitle}>{t("notes.emptyTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("notes.emptyDescription")}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={notes}
        keyExtractor={noteKey}
        renderItem={renderItem}
        onRefresh={refresh}
        refreshing={false}
        contentContainerStyle={styles.listContent}
        testID="notes-list"
      />
    );
  }

  return (
    <View style={styles.container} testID="notes-screen">
      <StackScreenHeader title={t("notes.title")} />
      {unsupportedHostLabels.length > 0 ? (
        <HostUpgradeNotices labels={unsupportedHostLabels} />
      ) : null}
      {body}
    </View>
  );
}

function HostUpgradeNotices({ labels }: { labels: readonly string[] }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.noticeWrap} testID="notes-host-upgrade-notice">
      <View style={styles.notice}>
        {labels.map((label) => (
          <Text key={label} style={styles.noticeText}>
            {t("notes.hostUpgrade", { host: label })}
          </Text>
        ))}
      </View>
    </View>
  );
}

function noteKey(note: HostNote): string {
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
    gap: theme.spacing[2],
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
  noticeWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  notice: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  noticeText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  listContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingBottom: theme.spacing[6],
  },
}));

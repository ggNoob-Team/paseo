import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { openExternalUrl } from "@/utils/open-external-url";
import type { Theme } from "@/styles/theme";
import { extractNoteLinks } from "./note-links";
import { useCopyLink } from "@/hooks/use-copy-link";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedCopy = withUnistyles(Copy);

/**
 * The links a note mentions, each openable and copyable.
 *
 * Listing the links gives every platform an explicit copy action alongside
 * the Markdown renderer's long-press gesture.
 */
export function NoteLinksSection({ text }: { text: string }): ReactElement | null {
  const { t } = useTranslation();
  const links = useMemo(() => extractNoteLinks(text), [text]);
  const copyLink = useCopyLink();

  if (links.length === 0) return null;

  return (
    <View style={styles.section} testID="note-links">
      <Text style={styles.title}>{t("notes.linksTitle")}</Text>
      {links.map((url) => (
        <NoteLinkRow key={url} url={url} onCopy={copyLink} />
      ))}
    </View>
  );
}

function NoteLinkRow({
  url,
  onCopy,
}: {
  url: string;
  onCopy: (url: string) => void;
}): ReactElement {
  const { t } = useTranslation();

  const handleOpen = useCallback(() => {
    void openExternalUrl(url).catch(() => undefined);
  }, [url]);

  const handleCopy = useCallback(() => {
    onCopy(url);
  }, [onCopy, url]);

  return (
    <View style={styles.row}>
      <PressHighlight
        onPress={handleOpen}
        onLongPress={handleCopy}
        style={styles.linkPressable}
        highlightStyle={styles.linkHighlight}
        accessibilityRole="link"
        accessibilityLabel={url}
        accessibilityHint={t("notes.copyLinkHint")}
        testID={`note-link-${url}`}
      >
        <Text numberOfLines={1} style={styles.linkText}>
          {url}
        </Text>
      </PressHighlight>
      <ToolbarButton
        onPress={handleCopy}
        style={styles.copyButton}
        label={t("notes.copyLink")}
        testID="note-link-copy"
      >
        <ThemedCopy size={16} uniProps={mutedColorMapping} />
      </ToolbarButton>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[4],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  linkPressable: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[1],
  },
  linkHighlight: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  linkText: {
    color: theme.colors.accentBright,
    fontSize: theme.fontSize.sm,
  },
  copyButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));

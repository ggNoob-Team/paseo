import { useCallback, useMemo, type ReactElement } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { openExternalUrl } from "@/utils/open-external-url";
import type { Theme } from "@/styles/theme";
import { extractNoteLinks } from "./note-links";
import { useCopyNoteLink } from "./use-copy-note-link";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedCopy = withUnistyles(Copy);

/**
 * The links a note mentions, each openable and copyable.
 *
 * A long press on an inline link copies it on Android and web, but not on iOS,
 * where inline links are drawn inside a UITextView that does not forward long
 * presses. Listing the links gives every platform the same way to copy one.
 */
export function NoteLinksSection({ text }: { text: string }): ReactElement | null {
  const { t } = useTranslation();
  const links = useMemo(() => extractNoteLinks(text), [text]);
  const copyLink = useCopyNoteLink();

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
      <Pressable
        onPress={handleOpen}
        onLongPress={handleCopy}
        style={styles.linkPressable}
        accessibilityRole="link"
        accessibilityLabel={url}
        accessibilityHint={t("notes.copyLinkHint")}
        testID={`note-link-${url}`}
      >
        <Text numberOfLines={1} style={styles.linkText}>
          {url}
        </Text>
      </Pressable>
      <Pressable
        onPress={handleCopy}
        style={copyButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("notes.copyLink")}
        testID="note-link-copy"
      >
        <ThemedCopy size={16} uniProps={mutedColorMapping} />
      </Pressable>
    </View>
  );
}

function copyButtonStyle({ hovered, pressed }: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [
    styles.copyButton,
    hovered ? styles.copyButtonHovered : null,
    pressed ? styles.copyButtonPressed : null,
  ];
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
  copyButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  copyButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
}));

import { useEffect, useMemo, useState } from "react";
import { Modal, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { resolveConfirmDialog, subscribeConfirmDialog } from "@/utils/confirm-dialog";

interface PendingDialog {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

/**
 * Draws the web app's confirmation dialog (see utils/confirm-dialog.ts). Mounted
 * once near the root: `confirmDialog()` reaches it through the subscription and
 * resolves with the button the user pressed.
 */
export function ConfirmDialogHost(): React.ReactNode {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingDialog | null>(null);

  useEffect(() => {
    return subscribeConfirmDialog((next) => {
      setPending(
        next
          ? {
              title: next.input.title,
              message: next.input.message,
              confirmLabel: next.input.confirmLabel ?? t("common.actions.confirm"),
              cancelLabel: next.input.cancelLabel ?? t("common.actions.cancel"),
              destructive: next.input.destructive === true,
            }
          : null,
      );
    });
  }, [t]);

  const cancel = useMemo(() => () => resolveConfirmDialog(false), []);
  const confirm = useMemo(() => () => resolveConfirmDialog(true), []);

  if (!pending) {
    return null;
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <PressHighlight
          style={styles.backdropPress}
          highlightStyle={styles.backdropHighlight}
          onPress={cancel}
          accessibilityRole="button"
        />
        <View style={styles.card} testID="confirm-dialog">
          <Text style={styles.title}>{pending.title}</Text>
          <Text style={styles.message}>{pending.message}</Text>
          <View style={styles.actions}>
            <Button variant="ghost" size="sm" onPress={cancel} testID="confirm-dialog-cancel">
              {pending.cancelLabel}
            </Button>
            <Button
              variant={pending.destructive ? "destructive" : "default"}
              size="sm"
              onPress={confirm}
              testID="confirm-dialog-confirm"
            >
              {pending.confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: theme.spacing[4],
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropHighlight: {
    backgroundColor: "transparent",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    ...theme.shadow.md,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
}));

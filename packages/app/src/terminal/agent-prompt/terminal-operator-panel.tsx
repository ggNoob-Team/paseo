import { Modal, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollView } from "@/components/ui/scroll-view";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { truncateTerminalText } from "./terminal-output";

export type TerminalOperatorStage =
  | "starting"
  | "planning"
  | "executing"
  | "summarizing"
  | "done"
  | "error";

export interface TerminalOperatorRun {
  request: string;
  stage: TerminalOperatorStage;
  commands: string[];
  output: string;
  summary: string | null;
  error: string | null;
}

interface TerminalOperatorPanelProps {
  run: TerminalOperatorRun | null;
  modelLabel: string;
  onClose: () => void;
}

const STAGE_KEYS: Record<TerminalOperatorStage, string> = {
  starting: "workspace.terminal.agentPrompt.stageStarting",
  planning: "workspace.terminal.agentPrompt.stagePlanning",
  executing: "workspace.terminal.agentPrompt.stageExecuting",
  summarizing: "workspace.terminal.agentPrompt.stageSummarizing",
  done: "workspace.terminal.agentPrompt.stageDone",
  error: "workspace.terminal.agentPrompt.stageError",
};

const OUTPUT_PREVIEW_CHARS = 2_000;

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function isRunFinished(stage: TerminalOperatorStage): boolean {
  return stage === "done" || stage === "error";
}

/**
 * Wide layouts get a floating card anchored over the terminal's bottom-right
 * corner; compact layouts use a bottom sheet so the summary stays reachable
 * with one hand.
 */
export function TerminalOperatorPanel({ run, modelLabel, onClose }: TerminalOperatorPanelProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const busy = run !== null && !isRunFinished(run.stage);

  return (
    <Modal
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
      statusBarTranslucent
      transparent
      visible={run !== null}
    >
      <View style={[styles.overlay, isCompact ? styles.overlayCompact : styles.overlayWide]}>
        <PressHighlight
          accessibilityLabel={t("workspace.terminal.agentPrompt.close")}
          disabled={busy}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        {run ? (
          <View
            style={[
              styles.panel,
              isCompact ? styles.panelCompact : styles.panelWide,
              isCompact ? { paddingBottom: Math.max(insets.bottom, 12) } : null,
            ]}
            testID="terminal-operator-panel"
          >
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{t("workspace.terminal.agentPrompt.panelTitle")}</Text>
                <Text numberOfLines={1} style={styles.model}>
                  {modelLabel}
                </Text>
              </View>
              <Button
                accessibilityLabel={t("workspace.terminal.agentPrompt.close")}
                disabled={busy}
                leftIcon={X}
                onPress={onClose}
                size="xs"
                testID="terminal-operator-close"
                variant="ghost"
              />
            </View>

            <ScrollView
              contentContainerStyle={styles.bodyContent}
              style={styles.body}
              testID="terminal-operator-body"
            >
              <View style={styles.requestBlock}>
                <Text style={styles.sectionLabel}>
                  {t("workspace.terminal.agentPrompt.request")}
                </Text>
                <Text selectable style={styles.requestText}>
                  {run.request}
                </Text>
              </View>

              <View style={styles.stageRow}>
                {busy ? <ThemedLoadingSpinner size="small" /> : null}
                <Text
                  style={[styles.stageText, run.stage === "error" ? styles.errorText : null]}
                  testID="terminal-operator-stage"
                >
                  {t(STAGE_KEYS[run.stage])}
                </Text>
              </View>

              {run.commands.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {t("workspace.terminal.agentPrompt.commands")}
                  </Text>
                  <View style={styles.commandRow}>
                    <Text selectable style={styles.commandText}>
                      {run.commands
                        .map((command, index) => String(index + 1) + ". " + command)
                        .join(String.fromCharCode(10))}
                    </Text>
                  </View>
                </View>
              ) : null}

              {run.output ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {t("workspace.terminal.agentPrompt.output")}
                  </Text>
                  <View style={styles.outputBox}>
                    <Text selectable style={styles.outputText}>
                      {truncateTerminalText(run.output, OUTPUT_PREVIEW_CHARS)}
                    </Text>
                  </View>
                </View>
              ) : null}

              {run.error ? (
                <Text style={styles.errorText} testID="terminal-operator-error">
                  {run.error}
                </Text>
              ) : null}

              {run.summary ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {t("workspace.terminal.agentPrompt.summary")}
                  </Text>
                  <View style={styles.summaryBox} testID="terminal-operator-summary">
                    <MarkdownRenderer compact={isCompact} text={run.summary} />
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
  },
  overlayWide: {
    alignItems: "flex-end",
    justifyContent: "flex-end",
    padding: theme.spacing[4],
  },
  overlayCompact: {
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.38)",
  },
  panel: {
    flexShrink: 1,
    minHeight: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  panelWide: {
    width: 460,
    maxWidth: "92%",
    maxHeight: "58%",
    marginBottom: 84,
    borderRadius: theme.borderRadius.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  panelCompact: {
    width: "100%",
    maxHeight: "72%",
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  model: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  body: {
    flexShrink: 1,
    minHeight: 0,
  },
  bodyContent: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  requestBlock: {
    gap: theme.spacing[1],
  },
  requestText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stageText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  commandRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  commandText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  outputBox: {
    maxHeight: 170,
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
  },
  outputText: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  summaryBox: {
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));

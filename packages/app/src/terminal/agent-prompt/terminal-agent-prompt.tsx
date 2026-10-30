import { ArrowUp } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useAgentFormState } from "@/hooks/use-agent-form-state";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import {
  buildCommandPlanningPrompt,
  buildCommandSummaryPrompt,
  parseCommandPlan,
} from "./command-plan";
import {
  archiveTerminalOperatorSession,
  ensureTerminalOperatorSession,
  TerminalOperatorError,
  type TerminalOperatorSession,
} from "./operator-session";
import { selectTerminalPromptAgent } from "./select-agent";
import { TerminalModelSelector } from "./terminal-model-selector";
import { TerminalOperatorPanel, type TerminalOperatorRun } from "./terminal-operator-panel";

interface TerminalAgentPromptProps {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string;
  projectId: string | null;
  runCommands: (commands: string[]) => Promise<string>;
}

const COMMAND_PLAN_TIMEOUT_MS = 120_000;
const SUMMARY_TIMEOUT_MS = 120_000;

const AgentTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function describeError(error: unknown, translate: (key: string) => string): string {
  if (error instanceof TerminalOperatorError) {
    if (error.code === "unsupported_host") {
      return translate("workspace.terminal.agentPrompt.hostUnsupported");
    }
    return `${translate("workspace.terminal.agentPrompt.sessionFailed")}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function waitForOperatorReply(
  client: Pick<DaemonClient, "waitForFinish">,
  agentId: string,
  timeoutMs: number,
  translate: (key: string) => string,
): Promise<string> {
  const result = await client.waitForFinish(agentId, timeoutMs);
  if (result.status === "timeout") {
    throw new Error(translate("workspace.terminal.agentPrompt.timeout"));
  }
  if (result.status === "permission") {
    throw new Error(translate("workspace.terminal.agentPrompt.permission"));
  }
  if (result.status !== "idle") {
    throw new Error(result.error ?? translate("workspace.terminal.agentPrompt.failed"));
  }
  return result.lastMessage?.trim() ?? "";
}

export function TerminalAgentPrompt({
  serverId,
  workspaceId,
  workspaceDirectory,
  projectId,
  runCommands,
}: TerminalAgentPromptProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents ?? null);
  const focusedAgentId = useSessionStore(
    (state) => state.sessions[serverId]?.focusedAgentId ?? null,
  );
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<TerminalOperatorRun | null>(null);
  const sessionRef = useRef<TerminalOperatorSession | null>(null);
  const mountedRef = useRef(true);
  const clientRef = useRef(client);
  clientRef.current = client;

  const defaultAgent = useMemo(() => {
    if (!agents) {
      return null;
    }
    return selectTerminalPromptAgent({
      agents: agents.values(),
      workspaceId,
      workspaceDirectory,
      focusedAgentId,
    });
  }, [agents, focusedAgentId, workspaceDirectory, workspaceId]);

  const initialValues = useMemo(() => {
    if (!defaultAgent) {
      return undefined;
    }
    return {
      provider: defaultAgent.provider,
      model: defaultAgent.model,
    };
  }, [defaultAgent]);

  const modelForm = useAgentFormState({
    serverId,
    workingDir: workspaceDirectory,
    initialValues,
    isCreateFlow: true,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      const currentClient = clientRef.current;
      if (session && currentClient) {
        void archiveTerminalOperatorSession(currentClient, session);
      }
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const request = draft.trim();
    const provider = modelForm.selectedProvider;
    if (!request || !client || !provider || busy) {
      return;
    }
    const model = modelForm.selectedModel || null;
    Keyboard.dismiss();
    setBusy(true);
    setRun({ request, stage: "starting", commands: [], output: "", summary: null, error: null });

    try {
      const session = await ensureTerminalOperatorSession({
        client,
        existing: sessionRef.current,
        provider,
        model,
        cwd: workspaceDirectory,
        projectId,
      });
      if (!mountedRef.current) {
        void archiveTerminalOperatorSession(client, session);
        return;
      }
      sessionRef.current = session;
      setRun((current) => (current ? { ...current, stage: "planning" } : current));

      await client.sendAgentMessage(
        session.agentId,
        buildCommandPlanningPrompt({ request, cwd: workspaceDirectory }),
      );
      const planReply = await waitForOperatorReply(
        client,
        session.agentId,
        COMMAND_PLAN_TIMEOUT_MS,
        t,
      );
      const commands = parseCommandPlan(planReply);
      if (commands.length === 0) {
        throw new Error(t("workspace.terminal.agentPrompt.noCommands"));
      }
      if (!mountedRef.current) {
        return;
      }
      setRun((current) => (current ? { ...current, stage: "executing", commands } : current));

      const output = await runCommands(commands);
      if (!mountedRef.current) {
        return;
      }
      setRun((current) => (current ? { ...current, stage: "summarizing", output } : current));

      await client.sendAgentMessage(
        session.agentId,
        buildCommandSummaryPrompt({
          request,
          cwd: workspaceDirectory,
          commands,
          output,
        }),
      );
      const summaryReply = await waitForOperatorReply(
        client,
        session.agentId,
        SUMMARY_TIMEOUT_MS,
        t,
      );
      const summary = summaryReply || t("workspace.terminal.agentPrompt.noSummary");
      if (!mountedRef.current) {
        return;
      }
      setRun((current) => (current ? { ...current, stage: "done", summary } : current));
      inputRef.current?.reset();
      setDraft("");
    } catch (error) {
      if (mountedRef.current) {
        setRun((current) =>
          current ? { ...current, stage: "error", error: describeError(error, t) } : current,
        );
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [
    busy,
    client,
    draft,
    modelForm.selectedModel,
    modelForm.selectedProvider,
    projectId,
    runCommands,
    t,
    workspaceDirectory,
  ]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
  }, []);

  const handleClosePanel = useCallback(() => {
    if (!busy) {
      setRun(null);
    }
  }, [busy]);

  const enabled = Boolean(client && modelForm.selectedProvider);
  const canSubmit = enabled && draft.trim().length > 0 && !busy && !modelForm.isAllModelsLoading;
  const placeholder = t(
    enabled
      ? "workspace.terminal.agentPrompt.placeholder"
      : "workspace.terminal.agentPrompt.noModel",
  );
  const modelLabel =
    modelForm.selectedModel ||
    modelForm.selectedProvider ||
    t("workspace.terminal.agentPrompt.noModel");

  return (
    <View style={styles.root} testID="terminal-agent-prompt">
      <View style={styles.inputRow}>
        <TerminalModelSelector
          disabled={busy || modelForm.isAllModelsLoading}
          isLoading={modelForm.isAllModelsLoading}
          onSelect={modelForm.setProviderAndModelFromUser}
          providers={modelForm.modelSelectorProviders}
          selectedModel={modelForm.selectedModel}
          selectedProvider={modelForm.selectedProvider}
          serverId={serverId}
        />
        <AgentTextInput
          ref={inputRef}
          accessibilityLabel={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          editable={enabled && !busy}
          initialValue=""
          onChangeText={handleDraftChange}
          onSubmitEditing={handleSubmitPress}
          placeholder={placeholder}
          returnKeyType="send"
          style={styles.input}
          testID="terminal-agent-prompt-input"
        />
        <Button
          accessibilityLabel={t("workspace.terminal.agentPrompt.send")}
          disabled={!canSubmit}
          leftIcon={ArrowUp}
          loading={busy}
          onPress={handleSubmitPress}
          size="xs"
          style={styles.sendButton}
          testID="terminal-agent-prompt-send"
          variant="default"
        />
      </View>
      <TerminalOperatorPanel modelLabel={modelLabel} onClose={handleClosePanel} run={run} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  inputRow: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    paddingLeft: theme.spacing[1],
    paddingRight: 4,
  },
  input: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: 0,
  },
  sendButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 0,
  },
}));

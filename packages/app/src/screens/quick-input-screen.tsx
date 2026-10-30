import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, List, MessageSquare, Plus, Search, TriangleAlert } from "lucide-react-native";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { BackHeader } from "@/components/headers/back-header";
import { Button } from "@/components/ui/button";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { queueComposerMessage } from "@/composer/actions";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { useAppSettings } from "@/hooks/use-settings";
import { useAgentFormState, type FormInitialValues } from "@/hooks/use-agent-form-state";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  applyQuickInputModelOrdering,
  groupQuickInputSessions,
  quickInputSessionKey,
  quickInputModelSeedFromSession,
  rankQuickInputSessions,
  selectQuickInputModelSeedSession,
  type QuickInputReason,
  type QuickInputResult,
  type QuickInputSession,
} from "@/quick-input/model";
import {
  decideQuickInputSend,
  resolveQuickInputSendAttempt,
  type QuickInputSendAttempt,
} from "@/quick-input/send";
import {
  useQuickInputRecentPrompts,
  useQuickInputSessions,
} from "@/quick-input/use-quick-input-sessions";
import {
  type QuickInputSlowRouteProgress,
  useQuickInputSlowRoute,
} from "@/quick-input/use-quick-input-slow-route";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildHostRootRoute, buildOpenProjectRoute, buildSessionsRoute } from "@/utils/host-routes";

/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop, react-perf/jsx-no-jsx-as-prop -- list rows own per-session handlers and rerender with each result set */

const ThemedSearch = withUnistyles(Search);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedPlus = withUnistyles(Plus);
const ThemedList = withUnistyles(List);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const mutedIconMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
type QuickInputError = "sendFailed" | "hostOffline" | "sessionGone";

// eslint-disable-next-line complexity
export function QuickInputScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const serverId = useHostRouteServerId();
  const { settings } = useAppSettings();
  const hosts = useHosts();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const { sessions, isLoading } = useQuickInputSessions();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<QuickInputError | null>(null);
  const [slowRouteElapsedSeconds, setSlowRouteElapsedSeconds] = useState(0);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const sendingRef = useRef(false);
  const sendAttemptRef = useRef<QuickInputSendAttempt | null>(null);
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const recentPrompts = useQuickInputRecentPrompts(sessions, true);
  const localRanking = useMemo(
    () =>
      rankQuickInputSessions({
        sessions,
        query: trimmedQuery,
        recentPromptsBySession: recentPrompts,
      }),
    [recentPrompts, sessions, trimmedQuery],
  );
  const groupedSessions = useMemo(() => groupQuickInputSessions(sessions), [sessions]);
  const orderedSessions = useMemo(
    () => groupedSessions.flatMap((section) => section.sessions),
    [groupedSessions],
  );
  const newSessionTarget = useMemo(() => {
    const fallbackSession = orderedSessions.find((session) => session.workspaceId !== null) ?? null;
    const targetServerId = lastWorkspaceSelection?.serverId ?? fallbackSession?.serverId ?? null;
    const targetWorkspaceId =
      lastWorkspaceSelection?.workspaceId ?? fallbackSession?.workspaceId ?? null;
    const targetSessionCwd =
      orderedSessions.find(
        (session) =>
          session.serverId === targetServerId && session.workspaceId === targetWorkspaceId,
      )?.cwd ??
      fallbackSession?.cwd ??
      "";
    return {
      serverId: targetServerId,
      workspaceId: targetWorkspaceId,
      cwd: targetSessionCwd,
    };
  }, [lastWorkspaceSelection, orderedSessions]);
  const modelWorkingDirectory =
    useWorkspaceDirectory(newSessionTarget.serverId, newSessionTarget.workspaceId) ??
    newSessionTarget.cwd;
  const modelSeedTargetKey = `${newSessionTarget.serverId ?? ""}:${newSessionTarget.workspaceId ?? ""}`;
  const modelSeedRef = useRef<{ targetKey: string; values: FormInitialValues } | null>(null);
  if (modelSeedRef.current?.targetKey !== modelSeedTargetKey) {
    const seed = quickInputModelSeedFromSession(
      selectQuickInputModelSeedSession(sessions, newSessionTarget),
    );
    if (seed) {
      modelSeedRef.current = {
        targetKey: modelSeedTargetKey,
        values: {
          provider: seed.provider,
          model: seed.model,
          thinkingOptionId: seed.thinkingOptionId,
        },
      };
    }
  }
  const modelInitialValues =
    modelSeedRef.current?.targetKey === modelSeedTargetKey
      ? modelSeedRef.current.values
      : undefined;
  const modelForm = useAgentFormState({
    serverId: newSessionTarget.serverId,
    workingDir: modelWorkingDirectory,
    initialValues: modelInitialValues,
    isCreateFlow: true,
    isVisible: true,
  });
  const setProviderAndModelFromUser = modelForm.setProviderAndModelFromUser;
  const routeModel = useMemo(() => {
    const selectedModel = modelForm.selectedModel.trim();
    if (selectedModel) {
      return selectedModel;
    }
    if (
      modelInitialValues?.model &&
      (!modelForm.selectedProvider || modelForm.selectedProvider === modelInitialValues.provider)
    ) {
      return modelInitialValues.model;
    }
    const provider = modelForm.modelSelectorProviders.find(
      (entry) => entry.id === modelForm.selectedProvider,
    );
    if (provider?.modelSelection.kind !== "models") {
      return null;
    }
    return (
      provider.modelSelection.rows.find((row) => row.isDefault)?.modelId ??
      provider.modelSelection.rows[0]?.modelId ??
      null
    );
  }, [
    modelForm.modelSelectorProviders,
    modelForm.selectedModel,
    modelForm.selectedProvider,
    modelInitialValues,
  ]);
  const routeSelection = useMemo(() => {
    const provider = modelForm.selectedProvider ?? modelInitialValues?.provider ?? null;
    if (!provider) {
      return null;
    }
    const inheritedThinkingOptionId =
      !modelForm.selectedProvider || modelForm.selectedProvider === modelInitialValues?.provider
        ? (modelInitialValues?.thinkingOptionId ?? "")
        : "";
    return {
      provider,
      model: routeModel,
      thinkingOptionId: modelForm.selectedThinkingOptionId || inheritedThinkingOptionId,
    };
  }, [
    modelForm.selectedProvider,
    modelForm.selectedThinkingOptionId,
    modelInitialValues,
    routeModel,
  ]);
  const slowRoute = useQuickInputSlowRoute({
    sessions,
    query: trimmedQuery,
    recentPromptsBySession: recentPrompts,
    localConfidence: localRanking.confidence,
    selection: routeSelection,
    enabled: isSearching,
  });
  const ranking = useMemo(
    () => ({
      ...localRanking,
      results:
        slowRoute.status === "ready"
          ? applyQuickInputModelOrdering({
              results: localRanking.results,
              sessions,
              orderedKeys: slowRoute.orderedKeys,
              reason: slowRoute.reason,
            })
          : localRanking.results,
    }),
    [localRanking, sessions, slowRoute.orderedKeys, slowRoute.reason, slowRoute.status],
  );
  const activeResult = ranking.results[activeIndex] ?? ranking.results[0] ?? null;
  const fallbackSession = activeResult?.session ?? orderedSessions[0] ?? null;
  const awaitingSlowRoute =
    isSearching && localRanking.confidence !== "high" && slowRoute.status === "loading";
  const effectiveConfidence =
    slowRoute.status === "ready" ? slowRoute.confidence : localRanking.confidence;
  const showHost = hosts.length > 1;
  const useTwoColumns = width >= 900;
  const visibleResults = expanded ? ranking.results : ranking.results.slice(0, 5);
  const bottomStyle = useMemo(() => ({ paddingBottom: insets.bottom + 24 }), [insets.bottom]);

  useEffect(() => {
    if (!awaitingSlowRoute) {
      setSlowRouteElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSlowRouteElapsedSeconds(0);
    const timer = setInterval(() => {
      setSlowRouteElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [awaitingSlowRoute, trimmedQuery]);

  useEffect(() => {
    setActiveIndex(0);
    setExpanded(false);
  }, [trimmedQuery]);

  useEffect(() => {
    if (activeIndex >= ranking.results.length) {
      setActiveIndex(Math.max(0, ranking.results.length - 1));
    }
  }, [activeIndex, ranking.results.length]);

  const skip = useCallback(() => {
    router.replace(buildHostRootRoute(serverId ?? ""));
  }, [serverId]);

  const openSession = useCallback((session: QuickInputSession) => {
    navigateToAgent({
      serverId: session.serverId,
      agentId: session.agentId,
      workspaceId: session.workspaceId,
    });
  }, []);

  const handleModelSelect = useCallback(
    (provider: AgentProvider, modelId: string) => {
      setProviderAndModelFromUser(provider, modelId);
    },
    [setProviderAndModelFromUser],
  );

  const openSessionWithDraft = useCallback(
    (session: QuickInputSession) => {
      const text = query.trim();
      if (text) {
        const draftKey = buildDraftStoreKey({
          serverId: session.serverId,
          agentId: session.agentId,
        });
        const existing = useDraftStore.getState().getDraftInput(draftKey);
        const existingText = existing?.text ?? "";
        const trimmedExistingText = existingText.trim();
        let draftText = text;
        if (trimmedExistingText) {
          draftText = trimmedExistingText === text ? existingText : `${existingText}\n\n${text}`;
        }
        useDraftStore.getState().saveDraftInput({
          draftKey,
          draft: {
            text: draftText,
            attachments: existing?.attachments ?? [],
          },
        });
      }
      navigateToAgent({
        serverId: session.serverId,
        agentId: session.agentId,
        workspaceId: session.workspaceId,
      });
    },
    [query],
  );

  const sendToSession = useCallback(
    async (session: QuickInputSession) => {
      const text = query.trim();
      if (!text || sendingRef.current) {
        return;
      }
      const liveSession = useSessionStore.getState().sessions[session.serverId];
      const liveAgent = liveSession?.agents.get(session.agentId);
      if (!liveAgent || liveAgent.archivedAt) {
        setSendError("sessionGone");
        return;
      }
      const client = getHostRuntimeStore().getClient(session.serverId);
      if (!client) {
        setSendError("hostOffline");
        return;
      }

      const key = quickInputSessionKey(session);
      const hasPendingPermission = liveAgent.pendingPermissions.length > 0;
      const decision = decideQuickInputSend({
        sendBehavior: settings.sendBehavior,
        hasPendingPermission,
        isRunning: selectAgentTurnPresentation(liveSession, session.agentId).isActive,
      });
      if (decision.kind === "queue") {
        queueComposerMessage({
          agentId: session.agentId,
          text,
          attachments: [],
          queue: {
            read: (agentId) =>
              useSessionStore.getState().sessions[session.serverId]?.queuedMessages?.get(agentId) ??
              [],
            write: (updater) =>
              useSessionStore.getState().setQueuedMessages(session.serverId, updater),
          },
        });
        sendAttemptRef.current = null;
        setQuery("");
        navigateToAgent({
          serverId: session.serverId,
          agentId: session.agentId,
          workspaceId: session.workspaceId,
        });
        return;
      }

      const attempt = resolveQuickInputSendAttempt(sendAttemptRef.current, key, text);
      sendAttemptRef.current = attempt;

      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      try {
        await client.sendAgentMessage(session.agentId, text, {
          messageId: attempt.messageId,
          activeTurnBehavior: decision.activeTurnBehavior,
        });
        sendAttemptRef.current = null;
        setQuery("");
        navigateToAgent({
          serverId: session.serverId,
          agentId: session.agentId,
          workspaceId: session.workspaceId,
        });
      } catch {
        setSendError("sendFailed");
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [query, settings.sendBehavior],
  );

  const openNewSession = useCallback(() => {
    if (!newSessionTarget.serverId || !newSessionTarget.workspaceId) {
      router.replace(buildOpenProjectRoute());
      return;
    }
    const draftId = generateDraftId();
    const text = query.trim();
    if (text) {
      useDraftStore.getState().saveDraftInput({
        draftKey: buildDraftStoreKey({
          serverId: newSessionTarget.serverId,
          agentId: draftId,
          draftId,
        }),
        draft: { text, attachments: [] },
      });
    }
    navigateToWorkspace({
      serverId: newSessionTarget.serverId,
      workspaceId: newSessionTarget.workspaceId,
      target: { kind: "draft", draftId },
    });
  }, [newSessionTarget, query]);

  const browseAll = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const handleEnter = useCallback(() => {
    if (!trimmedQuery || !activeResult || awaitingSlowRoute) {
      return;
    }
    openSessionWithDraft(activeResult.session);
  }, [activeResult, awaitingSlowRoute, openSessionWithDraft, trimmedQuery]);

  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
      const key = event.nativeEvent.key;
      if (key === "Escape") {
        event.preventDefault?.();
        skip();
        return;
      }
      if (key !== "ArrowDown" && key !== "ArrowUp") {
        return;
      }
      event.preventDefault?.();
      setActiveIndex((current) => {
        if (ranking.results.length === 0) {
          return 0;
        }
        const delta = key === "ArrowDown" ? 1 : -1;
        return Math.max(0, Math.min(ranking.results.length - 1, current + delta));
      });
    },
    [ranking.results.length, skip],
  );

  const handleResultPress = useCallback(
    (result: QuickInputResult) => {
      if (trimmedQuery) openSessionWithDraft(result.session);
      else openSession(result.session);
    },
    [openSession, openSessionWithDraft, trimmedQuery],
  );

  const showEmptyFallback = isSearching && ranking.results.length === 0 && !awaitingSlowRoute;
  const showLowConfidence =
    isSearching &&
    ranking.results.length > 0 &&
    effectiveConfidence === "low" &&
    !awaitingSlowRoute;
  let fallbackDetail: string | null = null;
  if (
    slowRoute.status === "ready" &&
    slowRoute.explanation &&
    (slowRoute.orderedKeys.length > 0 || ranking.results.length === 0)
  ) {
    fallbackDetail = slowRoute.explanation;
  } else if (slowRoute.status === "error") {
    fallbackDetail = t(`quickInput.slowRouteErrors.${slowRoute.errorCode ?? "unknown"}`, {
      provider: slowRoute.errorProvider ?? t("quickInput.slowRouteProviderFallback"),
    });
  }

  return (
    <View style={styles.container}>
      <BackHeader
        title={t("quickInput.title")}
        onBack={skip}
        rightContent={
          <Button variant="ghost" size="sm" onPress={skip} disabled={sending}>
            {t("quickInput.actions.skip")}
          </Button>
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, bottomStyle]}
        keyboardShouldPersistTaps="handled"
        testID="quick-input-screen"
      >
        <View style={styles.hero}>
          <View style={[styles.inputShell, isSearching && styles.inputShellActive]}>
            <ThemedSearch size={18} uniProps={mutedIconMapping} />
            <View style={styles.modelSelectorWrap} testID="quick-input-model-selector">
              <CombinedModelSelector
                providers={modelForm.modelSelectorProviders}
                selectedProvider={modelForm.selectedProvider ?? ""}
                selectedModel={modelForm.selectedModel}
                onSelect={handleModelSelect}
                isLoading={modelForm.isAllModelsLoading}
                disabled={sending}
                onOpen={modelForm.refetchProviderModelsIfStale}
                onClose={() => inputRef.current?.focus()}
                onRetryProvider={modelForm.refreshProviderModels}
                isRetryingProvider={modelForm.isProviderModelsRefreshing}
                serverId={modelForm.selectedServerId}
                desktopPlacement="bottom-start"
                desktopMinWidth={360}
                toolbar={{ glyphSize: 16, showCaret: true }}
              />
            </View>
            <View style={styles.inputDivider} />
            <ThemedTextInput
              ref={inputRef}
              initialValue={query}
              onChangeText={(value) => {
                setQuery(value);
                setSendError(null);
              }}
              onSubmitEditing={handleEnter}
              onKeyPress={handleKeyPress}
              placeholder={t("quickInput.placeholder")}
              accessibilityLabel={t("quickInput.placeholder")}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType={isSearching ? "go" : "search"}
              style={styles.input}
              testID="quick-input-field"
            />
            <Button
              size="xs"
              variant="default"
              disabled={!isSearching || !activeResult || awaitingSlowRoute}
              onPress={handleEnter}
              accessibilityLabel={t("quickInput.actions.open")}
              testID="quick-input-submit"
              leftIcon={(color: string) => <ArrowRight size={14} color={color} />}
            />
          </View>
          <Text style={styles.hint}>
            {isSearching ? t("quickInput.searchHint") : t("quickInput.idleHint")}
          </Text>
          {awaitingSlowRoute ? (
            <SlowRouteProgress progress={slowRoute.progress} seconds={slowRouteElapsedSeconds} />
          ) : null}
          {sendError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <ThemedTriangleAlert size={16} uniProps={mutedIconMapping} />
              <Text style={styles.errorText}>{t(`quickInput.errors.${sendError}`)}</Text>
            </View>
          ) : null}
        </View>

        {isLoading && sessions.length === 0 ? (
          <View style={styles.loading}>
            <ThemedLoadingSpinner size="small" />
            <Text style={styles.mutedText}>{t("quickInput.loading")}</Text>
          </View>
        ) : null}

        {!isSearching && !isLoading && sessions.length === 0 ? (
          <EmptySessions
            onNewSession={openNewSession}
            onBrowseAll={browseAll}
            showBrowse={hosts.length > 0}
          />
        ) : null}

        {!isSearching && sessions.length > 0 ? (
          <View style={styles.sections}>
            {groupedSessions.map((section) => (
              <View key={section.id} style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t(`quickInput.sections.${section.id}`)}
                  <Text style={styles.sectionCount}> {section.sessions.length}</Text>
                </Text>
                <View style={[styles.rows, useTwoColumns && styles.grid]}>
                  {section.sessions.map((session) => (
                    <SessionRow
                      key={quickInputSessionKey(session)}
                      session={session}
                      recentMessage={recentPrompts[quickInputSessionKey(session)]?.at(-1) ?? null}
                      showHost={showHost}
                      layout={useTwoColumns ? "half" : "full"}
                      onPress={() => openSession(session)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {isSearching ? (
          <View style={styles.results}>
            {showLowConfidence ? (
              <FallbackPanel
                title={t("quickInput.fallback.lowTitle")}
                description={t("quickInput.fallback.lowDescription")}
                session={fallbackSession}
                onSend={fallbackSession ? () => void sendToSession(fallbackSession) : undefined}
                onNewSession={openNewSession}
                onBrowseAll={browseAll}
                detail={fallbackDetail}
                sending={sending}
              />
            ) : null}

            {showEmptyFallback ? (
              <FallbackPanel
                title={t("quickInput.fallback.noneTitle")}
                description={t("quickInput.fallback.noneDescription")}
                session={fallbackSession}
                onSend={fallbackSession ? () => void sendToSession(fallbackSession) : undefined}
                onNewSession={openNewSession}
                onBrowseAll={browseAll}
                detail={fallbackDetail}
                sending={sending}
              />
            ) : null}

            {visibleResults.length > 0 ? (
              <View style={styles.rankedRows}>
                {visibleResults.map((result, index) => (
                  <SessionRow
                    key={quickInputSessionKey(result.session)}
                    session={result.session}
                    reason={result.reason}
                    matchedText={result.matchedText}
                    recentMessage={
                      recentPrompts[quickInputSessionKey(result.session)]?.at(-1) ?? null
                    }
                    modelRanked={result.modelRanked}
                    showHost={showHost}
                    selected={activeIndex === index}
                    priority={index === 0 ? "primary" : "compact"}
                    isSending={sending && activeIndex === index}
                    onPress={() => handleResultPress(result)}
                  />
                ))}
              </View>
            ) : null}

            {ranking.results.length > 5 ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => setExpanded((current) => !current)}
                style={styles.viewAllButton}
              >
                {expanded
                  ? t("quickInput.actions.showLess")
                  : t("quickInput.actions.viewAll", { count: ranking.results.length })}
              </Button>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function progressStageIndex(stage: QuickInputSlowRouteProgress["stage"]): number {
  switch (stage) {
    case "preparing":
      return 0;
    case "validating":
      return 2;
    default:
      return 1;
  }
}

function SlowRouteProgress({
  progress,
  seconds,
}: {
  progress: QuickInputSlowRouteProgress | null;
  seconds: number;
}) {
  const { t } = useTranslation();
  const stage = progress?.stage ?? "preparing";
  const stageIndex = progressStageIndex(stage);
  const model = [progress?.provider, progress?.model].filter(Boolean).join(" · ");
  return (
    <View style={styles.slowStatusCard} testID="quick-input-route-progress">
      <View style={styles.slowStatusHeader}>
        <ThemedLoadingSpinner size="small" />
        <Text style={styles.slowStatusTitle}>{t("quickInput.slowRouteProgress.title")}</Text>
        <Text style={styles.slowStatusElapsed}>
          {t("quickInput.slowRouteProgress.elapsed", { seconds })}
        </Text>
      </View>
      <View style={styles.slowStatusSteps}>
        {(["preparing", "thinking", "validating"] as const).map((step, index) => {
          const completed = index < stageIndex;
          const active = index === stageIndex;
          return (
            <View key={step} style={styles.slowStatusStep}>
              <View
                style={[
                  styles.slowStatusStepDot,
                  completed && styles.slowStatusStepDotDone,
                  active && styles.slowStatusStepDotActive,
                ]}
              />
              <Text
                style={[
                  styles.slowStatusStepLabel,
                  (active || completed) && styles.slowStatusStepLabelActive,
                ]}
              >
                {t(`quickInput.slowRouteProgress.steps.${step}`)}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.slowStatusDetail}>
        {t(`quickInput.slowRouteProgress.${stage}`, {
          count: progress?.candidateCount ?? 0,
          model: model || t("quickInput.slowRouteProgress.choosingModel"),
        })}
      </Text>
      <Text style={styles.slowStatusNote}>{t("quickInput.slowRouteProgress.fastThinking")}</Text>
    </View>
  );
}

function FallbackPanel({
  title,
  description,
  session,
  onSend,
  onNewSession,
  onBrowseAll,
  detail,
  sending,
}: {
  title: string;
  description: string;
  session: QuickInputSession | null;
  onSend: (() => void) | undefined;
  onNewSession: () => void;
  onBrowseAll: () => void;
  detail: string | null;
  sending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fallbackPanel}>
      <View style={styles.fallbackHeader}>
        <ThemedTriangleAlert size={16} uniProps={mutedIconMapping} />
        <View style={styles.fallbackCopy}>
          <Text style={styles.fallbackTitle}>{title}</Text>
          <Text style={styles.fallbackDescription}>{description}</Text>
          {detail ? <Text style={styles.fallbackDetail}>{detail}</Text> : null}
        </View>
      </View>
      <View style={styles.fallbackActions}>
        {onSend && session ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={ThemedArrowRight}
            onPress={onSend}
            disabled={sending}
          >
            {t("quickInput.actions.sendTo", { title: session.title })}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" leftIcon={ThemedPlus} onPress={onNewSession}>
          {t("quickInput.actions.newSession")}
        </Button>
        <Button size="sm" variant="ghost" leftIcon={ThemedList} onPress={onBrowseAll}>
          {t("quickInput.actions.browseAll")}
        </Button>
      </View>
    </View>
  );
}

function EmptySessions({
  onNewSession,
  onBrowseAll,
  showBrowse,
}: {
  onNewSession: () => void;
  onBrowseAll: () => void;
  showBrowse: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.empty}>
      <MessageSquareIcon />
      <Text style={styles.emptyTitle}>{t("quickInput.empty.title")}</Text>
      <Text style={styles.emptyDescription}>{t("quickInput.empty.description")}</Text>
      <View style={styles.fallbackActions}>
        <Button size="sm" variant="secondary" leftIcon={ThemedPlus} onPress={onNewSession}>
          {t("quickInput.actions.newSession")}
        </Button>
        {showBrowse ? (
          <Button size="sm" variant="ghost" leftIcon={ThemedList} onPress={onBrowseAll}>
            {t("quickInput.actions.browseAll")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function MessageSquareIcon() {
  return <ThemedMessageSquare size={28} uniProps={mutedIconMapping} />;
}

function SessionRow({
  session,
  reason,
  matchedText,
  recentMessage,
  modelRanked = false,
  showHost,
  layout = "full",
  selected = false,
  priority = "compact",
  isSending = false,
  onPress,
}: {
  session: QuickInputSession;
  reason?: QuickInputReason;
  matchedText?: string | null;
  recentMessage?: string | null;
  modelRanked?: boolean;
  showHost: boolean;
  layout?: "full" | "half";
  selected?: boolean;
  priority?: "primary" | "compact";
  isSending?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo(session.lastActivityAt);
  const meta = [showHost ? session.hostLabel : null, session.projectName, session.workspaceName]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const status = resolveStatusLabel(session, t);
  const preview = (reason === "recent" && matchedText) || recentMessage || null;
  const rowStyle = useCallback(
    ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.row,
      layout === "half" && styles.rowHalf,
      priority === "primary" && styles.primaryRow,
      selected && styles.rowSelected,
      (pressed || hovered) && styles.rowHovered,
    ],
    [layout, priority, selected],
  );

  return (
    <PressHighlight
      onPress={onPress}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={`${session.title}${meta ? `, ${meta}` : ""}`}
      testID={`quick-input-session-${session.serverId}-${session.agentId}`}
    >
      <View style={styles.rowLeading}>
        <AgentStatusDot
          status={session.status}
          requiresAttention={session.requiresAttention}
          pendingPermissionCount={session.pendingPermissionCount}
        />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {session.title}
          </Text>
          {reason ? (
            <View style={styles.reasonBadge}>
              <Text style={styles.reasonText}>{t(`quickInput.reasons.${reason}`)}</Text>
            </View>
          ) : null}
          {modelRanked ? (
            <View style={styles.modelBadge}>
              <Text style={styles.modelBadgeText}>{t("quickInput.modelRanked")}</Text>
            </View>
          ) : null}
        </View>
        {preview ? (
          <Text style={styles.rowPreview} numberOfLines={1}>
            {reason === "recent" && matchedText ? `“${matchedText}”` : preview}
          </Text>
        ) : null}
        <View style={styles.rowMetaLine}>
          {meta ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <Text style={styles.rowDot}>·</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {status}
          </Text>
          <Text style={styles.rowDot}>·</Text>
          <Text style={styles.rowMeta}>{timeAgo}</Text>
        </View>
      </View>
      <View style={styles.rowTrailing}>
        {isSending ? (
          <ThemedLoadingSpinner size="small" />
        ) : (
          <ThemedArrowRight size={16} uniProps={mutedIconMapping} />
        )}
      </View>
    </PressHighlight>
  );
}

function resolveStatusLabel(
  session: QuickInputSession,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (session.pendingPermissionCount > 0 || session.requiresAttention) {
    return t("quickInput.status.attention");
  }
  if (session.isRunning) {
    return t("quickInput.status.running");
  }
  if (session.status === "error") {
    return t("agentList.status.error");
  }
  return t("agentList.status.idle");
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
    gap: theme.spacing[4],
  },
  hero: {
    gap: theme.spacing[2],
  },
  inputShell: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
  },
  inputShellActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  modelSelectorWrap: {
    minWidth: 0,
    maxWidth: {
      xs: 128,
      md: 220,
    },
    flexShrink: 4,
  },
  inputDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 32,
    padding: 0,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
  },
  slowStatusCard: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  slowStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  slowStatusTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  slowStatusElapsed: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  slowStatusSteps: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  slowStatusStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  slowStatusStepDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  slowStatusStepDotDone: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  slowStatusStepDotActive: {
    backgroundColor: theme.colors.accent,
  },
  slowStatusStepLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  slowStatusStepLabelActive: {
    color: theme.colors.foreground,
  },
  slowStatusDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  slowStatusNote: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  errorText: {
    flex: 1,
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  sections: {
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing[1],
  },
  sectionCount: {
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  rows: {
    gap: theme.spacing[1],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  results: {
    gap: theme.spacing[3],
  },
  rankedRows: {
    gap: theme.spacing[2],
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  primaryRow: {
    minHeight: 82,
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  rowHalf: {
    width: "49%",
  },
  rowSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowLeading: {
    width: 12,
    alignItems: "center",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  reasonBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  reasonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  modelBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  modelBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  rowMeta: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowDot: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowTrailing: {
    width: 24,
    alignItems: "center",
  },
  fallbackPanel: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fallbackHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  fallbackCopy: {
    flex: 1,
    gap: theme.spacing[1],
  },
  fallbackTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  fallbackDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  fallbackDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    lineHeight: 20,
  },
  fallbackActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  viewAllButton: {
    alignSelf: "center",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  emptyDescription: {
    maxWidth: 420,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    lineHeight: 22,
  },
}));

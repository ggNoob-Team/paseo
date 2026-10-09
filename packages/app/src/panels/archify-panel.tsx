import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  GitBranch,
  Layers,
  Network,
  RefreshCw,
  Search,
  Workflow,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import {
  ARCHIFY_ALL_TYPES,
  ARCHIFY_INITIAL_TYPES,
  type ArchifyAgentConfig,
  buildArchifyFocusScript,
  buildArchifySearchEntries,
  filterArchifySearchEntries,
  latestArchifyArtifactByType,
  resolveArchifyAgentConfig,
  resolveArchifyArtifactTabLabel,
  type ArchifySearchEntry,
} from "@/archify/model";
import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { FileHtmlPreview } from "@/file-pane/html-preview";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type {
  ArchifyArtifactSummary,
  ArchifyDiagramType,
  ArchifyEvidence,
  ArchifyEvidenceAnchor,
  ArchifyGenerationDiagram,
  ArchifyGenerationDiagramStatus,
  ArchifyGenerationTask,
} from "@getpaseo/protocol/messages";

interface ArchifyPreviewCommand {
  id: number;
  source: string;
}

const ThemedNetwork = withUnistyles(Network);
const archifyPanelPresentation = {
  label: (t) => t("archify.tabLabel"),
  subtitle: (t) => t("archify.tabSubtitle"),
  tooltip: (t) => t("archify.tabTooltip"),
  icon: ThemedNetwork,
} satisfies PanelPresentation;

function DiagramTypeIcon({
  type,
  color,
  size = 16,
}: {
  type: ArchifyDiagramType;
  color?: string;
  size?: number;
}): ReactElement {
  if (type === "architecture") return <Network color={color} size={size} />;
  if (type === "sequence") return <GitBranch color={color} size={size} />;
  if (type === "dataflow") return <Database color={color} size={size} />;
  if (type === "workflow") return <Workflow color={color} size={size} />;
  return <Layers color={color} size={size} />;
}

async function ensureArchifySkill(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  skillManagement: boolean;
}): Promise<void> {
  if (!input.skillManagement) return;
  const status = await input.client.getAgentSkillsStatus();
  if (!status.available.includes("paseo-archify")) {
    throw new Error("This Paseo host does not include the paseo-archify skill.");
  }
  if (status.selection.mode === "custom" && !status.selection.skills.includes("paseo-archify")) {
    const saved = await input.client.saveAgentSkillsSelection({
      mode: "custom",
      skills: [...status.selection.skills, "paseo-archify"],
    });
    if (saved.confirmationRequired) {
      throw new Error("Paseo needs confirmation before updating the managed skill selection.");
    }
  }
  await input.client.reconcileAgentSkills();
}

function ArchifyRefreshButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(), [onPress]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      style={styles.iconButton}
    >
      <RefreshCw size={15} color={styles.mutedColor.color} />
    </Pressable>
  );
}

function ArchifySearchResultRow({
  entry,
  nodeLabel,
  relationshipLabel,
  onSelect,
}: {
  entry: ArchifySearchEntry;
  nodeLabel: string;
  relationshipLabel: string;
  onSelect: (entry: ArchifySearchEntry) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);
  return (
    <Pressable onPress={handlePress} style={styles.resultRow}>
      <View style={styles.resultMain}>
        <Text style={styles.resultLabel}>{entry.label}</Text>
        <Text style={styles.resultDetail} numberOfLines={1}>
          {entry.detail}
        </Text>
      </View>
      <Text style={styles.resultKind}>{entry.kind === "node" ? nodeLabel : relationshipLabel}</Text>
    </Pressable>
  );
}

function ArchifyArtifactTab({
  artifact,
  active,
  label,
  typeLabel,
  onSelect,
}: {
  artifact: ArchifyArtifactSummary;
  active: boolean;
  label: string;
  typeLabel: string;
  onSelect: (artifactId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(artifact.id), [artifact.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${typeLabel}: ${label}`}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={[styles.artifactTab, active && styles.artifactTabActive]}
    >
      <DiagramTypeIcon
        type={artifact.type}
        size={14}
        color={active ? styles.activeColor.color : styles.mutedColor.color}
      />
      <Text numberOfLines={1} style={[styles.artifactTabText, active && styles.activeText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ArchifyGenerationToggle({
  collapsed,
  label,
  onToggle,
}: {
  collapsed: boolean;
  label: string;
  onToggle: () => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(), [onToggle]);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={styles.generationToggle}
    >
      {collapsed ? (
        <ChevronDown size={16} color={styles.mutedColor.color} />
      ) : (
        <ChevronUp size={16} color={styles.mutedColor.color} />
      )}
    </Pressable>
  );
}

function ArchifyTypeOption({
  type,
  label,
  selected,
  ready,
  disabled,
  onToggle,
}: {
  type: ArchifyDiagramType;
  label: string;
  selected: boolean;
  ready: boolean;
  disabled: boolean;
  onToggle: (type: ArchifyDiagramType) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(type), [onToggle, type]);
  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={[
        styles.typeOption,
        selected && styles.typeOptionSelected,
        ready && styles.typeOptionReady,
      ]}
    >
      <DiagramTypeIcon
        type={type}
        size={14}
        color={selected ? styles.activeColor.color : styles.mutedColor.color}
      />
      <Text style={[styles.typeOptionText, selected && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

function ArchifyGenerateButton({
  disabled,
  generating,
  label,
  onPress,
}: {
  disabled: boolean;
  generating: boolean;
  label: string;
  onPress: () => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(), [onPress]);
  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={[styles.generateButton, disabled && styles.generateButtonDisabled]}
    >
      {generating ? (
        <ActivityIndicator size="small" color={styles.generateText.color} />
      ) : (
        <Text style={styles.generateText}>{label}</Text>
      )}
    </Pressable>
  );
}

function UnavailableState({ message }: { message: string }): ReactElement {
  return (
    <View style={styles.centered}>
      <Text style={styles.centeredTitle}>Archify</Text>
      <Text style={styles.centeredText}>{message}</Text>
    </View>
  );
}

/** Coarse duration label: 12s, 1m 05s, 1h 03m. */
function formatArchifyDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function archifyElapsedMs(startedAt: string | null, finishedAt: string | null): number {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 0;
  const finished = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (Number.isNaN(finished)) return 0;
  return finished - started;
}

/** Ticks only while a diagram is still drawing, so the row shows live elapsed time. */
function useArchifyElapsedMs(startedAt: string | null, finishedAt: string | null): number {
  const [elapsedMs, setElapsedMs] = useState(() => archifyElapsedMs(startedAt, finishedAt));
  useEffect(() => {
    setElapsedMs(archifyElapsedMs(startedAt, finishedAt));
    if (!startedAt || finishedAt) return undefined;
    const timer = setInterval(() => setElapsedMs(archifyElapsedMs(startedAt, finishedAt)), 1000);
    return () => clearInterval(timer);
  }, [finishedAt, startedAt]);
  return elapsedMs;
}

function archifyDiagramStatusStyle(status: ArchifyGenerationDiagramStatus) {
  if (status === "delivered") return styles.diagramStatusDelivered;
  if (status === "failed") return styles.diagramStatusFailed;
  if (status === "drawing") return styles.diagramStatusDrawing;
  return styles.diagramStatusMuted;
}

function ArchifyGenerationDiagramRow({
  diagram,
  typeLabel,
  statusLabel,
}: {
  diagram: ArchifyGenerationDiagram;
  typeLabel: string;
  statusLabel: string;
}): ReactElement {
  const elapsedMs = useArchifyElapsedMs(diagram.startedAt, diagram.finishedAt);
  const duration = diagram.startedAt ? formatArchifyDuration(elapsedMs) : null;
  return (
    <View style={styles.diagramBlock}>
      <View style={styles.diagramRow}>
        <DiagramTypeIcon type={diagram.type} size={14} color={styles.mutedColor.color} />
        <Text style={styles.diagramType} numberOfLines={1}>
          {typeLabel}
        </Text>
        <Text style={[styles.diagramStatus, archifyDiagramStatusStyle(diagram.status)]}>
          {statusLabel}
        </Text>
        {duration ? <Text style={styles.diagramDuration}>{duration}</Text> : null}
      </View>
      {diagram.error ? (
        <Text style={styles.diagramError} numberOfLines={3}>
          {diagram.error}
        </Text>
      ) : null}
    </View>
  );
}

function archifyAnchorKey(anchor: ArchifyEvidenceAnchor): string {
  return `${anchor.kind}:${anchor.label}`;
}

function buildArchifyStartRequest(input: {
  workspaceId: string;
  types: readonly ArchifyDiagramType[];
  agentConfig: ArchifyAgentConfig;
  request?: string;
  scope?: string;
  anchors?: readonly ArchifyEvidenceAnchor[];
}) {
  return {
    workspaceId: input.workspaceId,
    types: [...input.types],
    provider: input.agentConfig.provider,
    ...(input.agentConfig.model ? { model: input.agentConfig.model } : {}),
    ...(input.agentConfig.modeId ? { modeId: input.agentConfig.modeId } : {}),
    ...(input.request ? { request: input.request } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.anchors?.length ? { anchors: [...input.anchors] } : {}),
  };
}

function ArchifyAnchorRow({
  anchor,
  kindLabel,
  selected,
  onToggle,
}: {
  anchor: ArchifyEvidenceAnchor;
  kindLabel: string;
  selected: boolean;
  onToggle: (anchor: ArchifyEvidenceAnchor) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(anchor), [anchor, onToggle]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={[styles.anchorRow, selected && styles.anchorRowSelected]}
    >
      <Text style={styles.anchorKind}>{kindLabel}</Text>
      <View style={styles.anchorMain}>
        <Text style={styles.anchorLabel} numberOfLines={1}>
          {anchor.label}
        </Text>
        {anchor.detail ? (
          <Text style={styles.anchorDetail} numberOfLines={1}>
            {anchor.detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={14} color={styles.activeColor.color} /> : null}
    </Pressable>
  );
}

// eslint-disable-next-line complexity
function ArchifyPanel(): ReactElement {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "archify", "ArchifyPanel requires archify target");
  const client = useHostRuntimeClient(serverId);
  const archifyHost = useHostFeature(serverId, "archify");
  // The panel runs through the daemon-owned pipeline; an older host that only
  // serves artifacts cannot drive a run.
  const archifyGenerationHost = useHostFeature(serverId, "archifyGeneration");
  const supported = archifyHost && archifyGenerationHost;
  const skillManagement = useHostFeature(serverId, "skillManagement");
  const workspaceDirectory = useWorkspaceFields(
    serverId,
    workspaceId,
    (workspace) => workspace.workspaceDirectory,
  );
  const { preferences } = useFormPreferences();
  const providers = useProvidersSnapshot(serverId, {
    cwd: workspaceDirectory,
    enabled: supported,
  });
  const agentConfig = useMemo(
    () => resolveArchifyAgentConfig({ entries: providers.entries, preferences }),
    [preferences, providers.entries],
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [generationTask, setGenerationTask] = useState<ArchifyGenerationTask | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [command, setCommand] = useState<ArchifyPreviewCommand | null>(null);
  const [isGenerationPanelCollapsed, setIsGenerationPanelCollapsed] = useState(false);
  const [request, setRequest] = useState("");
  const [scope, setScope] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<ArchifyDiagramType[]>([
    ...ARCHIFY_INITIAL_TYPES,
  ]);
  const [anchorStep, setAnchorStep] = useState<ArchifyEvidence | null>(null);
  const [isAnchorStepOpen, setIsAnchorStepOpen] = useState(false);
  const [isScanningAnchors, setIsScanningAnchors] = useState(false);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [selectedAnchorKeys, setSelectedAnchorKeys] = useState<string[]>([]);
  const autoStartedRef = useRef(false);
  const skillReadyRef = useRef(false);
  const previousGenerationRunningRef = useRef(false);
  const deliveredArtifactIdsRef = useRef<Set<string>>(new Set());
  const userSelectedArtifactRef = useRef(false);
  const generationTaskIdRef = useRef<string | null>(null);

  const generationRunning = generationTask?.status === "running";
  const generationTaskError = generationTask?.status === "failed" ? generationTask.error : null;
  const generationDeliveredCount =
    generationTask?.diagrams.filter((diagram) => diagram.status === "delivered").length ?? 0;
  const generationDiagramCount = generationTask?.diagrams.length ?? 0;
  const canRerunUnfinished =
    generationTask !== null &&
    generationTask.status !== "running" &&
    generationDeliveredCount < generationDiagramCount;

  const workspaceQuery = useFetchQuery({
    queryKey: ["archify", "workspace", serverId, workspaceId],
    queryFn: () => {
      if (!client) throw new Error("Archify host is offline");
      return client.openArchifyWorkspace(workspaceId);
    },
    enabled: Boolean(client && supported && workspaceId),
    dataShape: "list",
    staleTimeMs: 0,
  });
  const artifacts = useMemo(
    () => workspaceQuery.data?.artifacts ?? [],
    [workspaceQuery.data?.artifacts],
  );

  useEffect(() => {
    if (!artifacts.length) return;
    if (selectedArtifactId && artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
      return;
    }
    const latest = latestArchifyArtifactByType(artifacts);
    const preferred =
      latest.get("architecture") ??
      latest.get("sequence") ??
      latest.get("dataflow") ??
      latest.get("workflow") ??
      latest.get("lifecycle") ??
      artifacts[0];
    setSelectedArtifactId(preferred?.id ?? null);
  }, [artifacts, selectedArtifactId]);

  const artifactQuery = useFetchQuery({
    queryKey: ["archify", "artifact", serverId, workspaceId, selectedArtifactId],
    queryFn: () => {
      if (!client || !selectedArtifactId) throw new Error("Archify artifact is unavailable");
      return client.readArchifyArtifact(workspaceId, selectedArtifactId);
    },
    enabled: Boolean(client && supported && selectedArtifactId),
    dataShape: "value",
    staleTimeMs: 30_000,
  });
  const artifact = artifactQuery.data?.artifact ?? null;
  const searchEntries = useMemo(
    () => (artifact ? buildArchifySearchEntries(artifact.spec) : []),
    [artifact],
  );
  const searchResults = useMemo(
    () => filterArchifySearchEntries(searchEntries, searchQuery),
    [searchEntries, searchQuery],
  );
  const latestByType = useMemo(() => latestArchifyArtifactByType(artifacts), [artifacts]);
  const artifactTabLabels = useMemo(() => {
    const counts = new Map<ArchifyDiagramType, number>();
    const labels = new Map<string, string>();
    for (const item of artifacts) {
      const ordinal = (counts.get(item.type) ?? 0) + 1;
      counts.set(item.type, ordinal);
      labels.set(
        item.id,
        resolveArchifyArtifactTabLabel({
          artifact: item,
          typeLabel: t(`archify.types.${item.type}`),
          ordinal,
        }),
      );
    }
    return labels;
  }, [artifacts, t]);

  const startGeneration = useCallback(
    async (input?: {
      types?: readonly ArchifyDiagramType[];
      request?: string;
      scope?: string;
      anchors?: readonly ArchifyEvidenceAnchor[];
    }) => {
      if (!client || !agentConfig || !workspaceDirectory || isStarting) return;
      const types = input?.types?.length ? input.types : ARCHIFY_INITIAL_TYPES;
      setIsStarting(true);
      setGenerationError(null);
      try {
        if (!skillReadyRef.current) {
          await ensureArchifySkill({ client, skillManagement });
          skillReadyRef.current = true;
        }
        const task = await client.startArchifyGeneration(
          buildArchifyStartRequest({
            workspaceId,
            types,
            agentConfig,
            ...(input?.request ? { request: input.request } : {}),
            ...(input?.scope ? { scope: input.scope } : {}),
            ...(input?.anchors ? { anchors: input.anchors } : {}),
          }),
        );
        if (task) setGenerationTask(task);
        await workspaceQuery.refetch();
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsStarting(false);
      }
    },
    [
      agentConfig,
      client,
      isStarting,
      skillManagement,
      workspaceDirectory,
      workspaceId,
      workspaceQuery,
    ],
  );

  useEffect(() => {
    if (!client || !supported || !workspaceId) return;
    const subscription = client.observeArchifyGeneration();
    const unsubscribe = subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== "archify.generation.updated") return;
        if (message.payload.task.workspaceId !== workspaceId) return;
        setGenerationTask(message.payload.task);
      },
    });
    return () => {
      unsubscribe();
      void subscription.release().catch(() => undefined);
    };
  }, [client, supported, workspaceId]);

  useEffect(() => {
    if (!client || !supported || !workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const task = await client.getArchifyGeneration(workspaceId);
        if (!cancelled && task) setGenerationTask(task);
      } catch {
        // The panel simply starts from an empty state when the task cannot be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, supported, workspaceId]);

  useEffect(() => {
    if (autoStartedRef.current || !workspaceQuery.data?.autoGenerate) return;
    if (!agentConfig || !workspaceDirectory || !client) return;
    autoStartedRef.current = true;
    void startGeneration({ types: ARCHIFY_INITIAL_TYPES });
  }, [agentConfig, client, startGeneration, workspaceDirectory, workspaceQuery.data?.autoGenerate]);

  useEffect(() => {
    if (previousGenerationRunningRef.current && !generationRunning) {
      void workspaceQuery.refetch();
      void artifactQuery.refetch();
    }
    previousGenerationRunningRef.current = generationRunning;
  }, [artifactQuery, generationRunning, workspaceQuery]);

  // Progressive delivery: each push that reports a finished diagram refreshes
  // the artifact list and shows the first new diagram, instead of polling.
  const refetchWorkspace = workspaceQuery.refetch;
  useEffect(() => {
    if (!generationTask) return;
    if (generationTaskIdRef.current !== generationTask.taskId) {
      generationTaskIdRef.current = generationTask.taskId;
      deliveredArtifactIdsRef.current = new Set();
      userSelectedArtifactRef.current = false;
    }
    const newlyDelivered = generationTask.diagrams.filter(
      (diagram) =>
        diagram.artifact !== null && !deliveredArtifactIdsRef.current.has(diagram.artifactId),
    );
    if (newlyDelivered.length === 0) return;
    for (const diagram of newlyDelivered) {
      deliveredArtifactIdsRef.current.add(diagram.artifactId);
    }
    if (!userSelectedArtifactRef.current) {
      const first = newlyDelivered[0]?.artifact;
      if (first) setSelectedArtifactId(first.id);
    }
    void refetchWorkspace();
  }, [generationTask, refetchWorkspace]);

  const toggleType = useCallback((type: ArchifyDiagramType) => {
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((candidate) => candidate !== type)
        : [...current, type],
    );
  }, []);

  const selectSearchEntry = useCallback((entry: ArchifySearchEntry) => {
    setCommand((current) => ({
      id: (current?.id ?? 0) + 1,
      source: buildArchifyFocusScript(entry),
    }));
  }, []);

  const handleRefresh = useCallback(() => {
    void workspaceQuery.refetch();
    void artifactQuery.refetch();
  }, [artifactQuery, workspaceQuery]);

  const handleSelectArtifact = useCallback((artifactId: string) => {
    userSelectedArtifactRef.current = true;
    setSelectedArtifactId(artifactId);
    setCommand(null);
  }, []);

  const handleCancelGeneration = useCallback(() => {
    const taskId = generationTask?.taskId;
    if (!client || !taskId) return;
    void (async () => {
      try {
        const task = await client.cancelArchifyGeneration(taskId);
        if (task) setGenerationTask(task);
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [client, generationTask?.taskId]);

  const handleRerunUnfinished = useCallback(() => {
    const taskId = generationTask?.taskId;
    if (!client || !taskId) return;
    void (async () => {
      try {
        const task = await client.rerunArchifyGeneration(taskId);
        if (task) setGenerationTask(task);
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [client, generationTask?.taskId]);

  /** Confirm what the run covers before any worker starts drawing. */
  const handleGenerate = useCallback(() => {
    if (!client) return;
    setIsAnchorStepOpen(true);
    setIsScanningAnchors(true);
    setAnchorError(null);
    void (async () => {
      try {
        const evidence = await client.scanArchifyEvidence({ workspaceId });
        setAnchorStep(evidence);
        setSelectedAnchorKeys([]);
      } catch (error) {
        setAnchorError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsScanningAnchors(false);
      }
    })();
  }, [client, workspaceId]);

  const handleToggleAnchor = useCallback((anchor: ArchifyEvidenceAnchor) => {
    const key = archifyAnchorKey(anchor);
    setSelectedAnchorKeys((current) =>
      current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key],
    );
  }, []);

  const handleCloseAnchorStep = useCallback(() => {
    setIsAnchorStepOpen(false);
  }, []);

  const handleStartWithAnchors = useCallback(() => {
    const anchors =
      anchorStep?.anchors.filter((anchor) =>
        selectedAnchorKeys.includes(archifyAnchorKey(anchor)),
      ) ?? [];
    setIsAnchorStepOpen(false);
    void startGeneration({ types: selectedTypes, request, scope, anchors });
  }, [anchorStep, request, scope, selectedAnchorKeys, selectedTypes, startGeneration]);

  const handleGenerateWithoutAnchors = useCallback(() => {
    setIsAnchorStepOpen(false);
    void startGeneration({ types: selectedTypes, request, scope });
  }, [request, scope, selectedTypes, startGeneration]);

  const toggleGenerationPanel = useCallback(() => {
    setIsGenerationPanelCollapsed((collapsed) => !collapsed);
  }, []);

  if (!client) return <UnavailableState message={t("workspace.terminal.hostDisconnected")} />;
  if (!supported) return <UnavailableState message={t("archify.unavailable")} />;
  if (!workspaceDirectory) {
    return <UnavailableState message={t("panels.file.directoryMissing")} />;
  }

  const generating = isStarting || generationRunning;
  const currentGenerationError = generationError ?? generationTaskError;
  let statusText = t("archify.ready");
  if (generating) statusText = t("archify.generating");
  if (generationRunning && generationTask) {
    statusText = `${t("archify.generating")} · ${t(`archify.stage.${generationTask.stage}`)}`;
  }
  if (currentGenerationError) statusText = t("archify.generationFailed");

  let evidenceLine: string | null = null;
  if (generationTask?.evidenceRevision) {
    const revision = generationTask.evidenceRevision;
    evidenceLine = t(
      generationTask.evidenceCached ? "archify.evidence.cached" : "archify.evidence.scanned",
      { revision: revision.length > 12 ? revision.slice(0, 12) : revision },
    );
  }

  let previewContent: ReactElement;
  if (artifactQuery.isLoading && selectedArtifactId) {
    previewContent = (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.centeredText}>{t("archify.loadingArtifact")}</Text>
      </View>
    );
  } else if (artifact) {
    previewContent = (
      <FileHtmlPreview
        html={artifact.html}
        testID="archify-html-preview"
        command={command}
        commandBridge
      />
    );
  } else {
    previewContent = (
      <View style={styles.centered}>
        <Network size={28} color={styles.mutedColor.color} />
        <Text style={styles.centeredTitle}>{t("archify.emptyTitle")}</Text>
        <Text style={styles.centeredText}>{t("archify.emptyDescription")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Search size={15} color={styles.mutedColor.color} />
          <TextInput
            initialValue={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t("archify.searchPlaceholder")}
            placeholderTextColor={styles.mutedColor.color}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        <ArchifyRefreshButton label={t("archify.refresh")} onPress={handleRefresh} />
      </View>

      {searchQuery.trim() ? (
        <View style={styles.results}>
          {searchResults.length > 0 ? (
            searchResults.map((entry) => (
              <ArchifySearchResultRow
                key={entry.key}
                entry={entry}
                nodeLabel={t("archify.node")}
                relationshipLabel={t("archify.relationship")}
                onSelect={selectSearchEntry}
              />
            ))
          ) : (
            <Text style={styles.emptySearchText}>{t("archify.noResults")}</Text>
          )}
        </View>
      ) : null}

      <View style={styles.artifactTabs}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.artifactTabsScroll}
        >
          {artifacts.map((item) => (
            <ArchifyArtifactTab
              key={item.id}
              artifact={item}
              active={item.id === selectedArtifactId}
              label={artifactTabLabels.get(item.id) ?? t(`archify.types.${item.type}`)}
              typeLabel={t(`archify.types.${item.type}`)}
              onSelect={handleSelectArtifact}
            />
          ))}
        </ScrollView>
        <ArchifyGenerationToggle
          collapsed={isGenerationPanelCollapsed}
          label={
            isGenerationPanelCollapsed ? t("archify.showGeneration") : t("archify.hideGeneration")
          }
          onToggle={toggleGenerationPanel}
        />
      </View>

      {isGenerationPanelCollapsed ? null : (
        <View style={styles.generationPanel}>
          <View style={styles.generationHeader}>
            <Text style={styles.generationTitle}>{statusText}</Text>
            {generating ? <ActivityIndicator size="small" /> : null}
            {generationTask ? (
              <Text style={styles.progressText}>
                {generationDeliveredCount}/{generationDiagramCount}
              </Text>
            ) : null}
            {generationRunning ? (
              <Button variant="ghost" size="sm" onPress={handleCancelGeneration}>
                {t("common.actions.cancel")}
              </Button>
            ) : null}
            {canRerunUnfinished ? (
              <Button variant="ghost" size="sm" onPress={handleRerunUnfinished}>
                {t("archify.actions.rerunUnfinished")}
              </Button>
            ) : null}
          </View>
          {currentGenerationError ? (
            <Text style={styles.errorText}>{currentGenerationError}</Text>
          ) : null}
          {generationTask ? (
            <View style={styles.diagramList}>
              {generationTask.diagrams.map((diagram) => (
                <ArchifyGenerationDiagramRow
                  key={`${diagram.type}:${diagram.artifactId}`}
                  diagram={diagram}
                  typeLabel={t(`archify.types.${diagram.type}`)}
                  statusLabel={t(`archify.generation.status.${diagram.status}`)}
                />
              ))}
            </View>
          ) : null}
          {generationTask?.actionLine ? (
            <Text style={styles.actionLine} numberOfLines={1}>
              {generationTask.actionLine}
            </Text>
          ) : null}
          {evidenceLine ? (
            <Text style={styles.actionLine} numberOfLines={1}>
              {evidenceLine}
            </Text>
          ) : null}
          {isAnchorStepOpen ? (
            <View style={styles.anchorStep}>
              <View style={styles.anchorHeader}>
                <Text style={styles.anchorTitle}>{t("archify.anchors.title")}</Text>
                {isScanningAnchors ? <ActivityIndicator size="small" /> : null}
                <Text style={styles.progressText}>
                  {t("archify.anchors.selected", { count: selectedAnchorKeys.length })}
                </Text>
                <Button variant="ghost" size="sm" onPress={handleCloseAnchorStep}>
                  {t("common.actions.cancel")}
                </Button>
              </View>
              {anchorError ? <Text style={styles.errorText}>{anchorError}</Text> : null}
              {anchorStep && anchorStep.anchors.length === 0 ? (
                <Text style={styles.actionLine}>{t("archify.anchors.empty")}</Text>
              ) : null}
              {anchorStep && anchorStep.anchors.length > 0 ? (
                <ScrollView style={styles.anchorList} nestedScrollEnabled>
                  {anchorStep.anchors.map((anchor) => (
                    <ArchifyAnchorRow
                      key={archifyAnchorKey(anchor)}
                      anchor={anchor}
                      kindLabel={t(`archify.anchors.kind.${anchor.kind}`)}
                      selected={selectedAnchorKeys.includes(archifyAnchorKey(anchor))}
                      onToggle={handleToggleAnchor}
                    />
                  ))}
                </ScrollView>
              ) : null}
              <View style={styles.anchorActions}>
                <Button variant="ghost" size="sm" onPress={handleGenerateWithoutAnchors}>
                  {t("archify.anchors.wholeWorkspace")}
                </Button>
                <ArchifyGenerateButton
                  disabled={isScanningAnchors || generating}
                  generating={isStarting}
                  label={t("archify.anchors.generate")}
                  onPress={handleStartWithAnchors}
                />
              </View>
            </View>
          ) : null}
          <View style={styles.typeRow}>
            {ARCHIFY_ALL_TYPES.map((type) => (
              <ArchifyTypeOption
                key={type}
                type={type}
                label={t(`archify.types.${type}`)}
                selected={selectedTypes.includes(type)}
                ready={latestByType.has(type)}
                disabled={generating}
                onToggle={toggleType}
              />
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              initialValue={request}
              onChangeText={setRequest}
              placeholder={t("archify.requestPlaceholder")}
              placeholderTextColor={styles.mutedColor.color}
              style={[styles.formInput, styles.requestInput]}
              multiline
            />
          </View>
          <View style={styles.inputRow}>
            <TextInput
              initialValue={scope}
              onChangeText={setScope}
              placeholder={t("archify.scopePlaceholder")}
              placeholderTextColor={styles.mutedColor.color}
              style={styles.formInput}
            />
            <ArchifyGenerateButton
              disabled={generating || selectedTypes.length === 0 || !agentConfig}
              generating={generating}
              label={t("archify.generate")}
              onPress={handleGenerate}
            />
          </View>
          {!agentConfig ? (
            <Text style={styles.errorText}>{t("archify.providerUnavailable")}</Text>
          ) : null}
        </View>
      )}

      <View style={styles.preview}>{previewContent}</View>
    </View>
  );
}

export const archifyPanelRegistration = definePanel("archify", {
  component: ArchifyPanel,
  presentation: archifyPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    height: 36,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: 0,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  pressed: {
    opacity: 0.7,
  },
  results: {
    maxHeight: 220,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  resultMain: {
    flex: 1,
    minWidth: 0,
  },
  resultLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  resultDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  resultKind: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptySearchText: {
    padding: theme.spacing[3],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  artifactTabs: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  artifactTabsScroll: {
    flex: 1,
    minWidth: 0,
  },
  generationToggle: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  artifactTab: {
    maxWidth: 240,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginVertical: theme.spacing[1],
    marginRight: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    height: 30,
    borderRadius: theme.borderRadius.md,
  },
  artifactTabActive: {
    backgroundColor: theme.colors.surface2,
  },
  artifactTabText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  generationPanel: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  generationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  progressText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  diagramList: {
    gap: theme.spacing[1],
  },
  diagramBlock: {
    gap: 2,
  },
  diagramRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  diagramType: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  diagramStatus: {
    fontSize: theme.fontSize.sm,
  },
  diagramStatusMuted: {
    color: theme.colors.foregroundMuted,
  },
  diagramStatusDrawing: {
    color: theme.colors.foreground,
  },
  diagramStatusDelivered: {
    color: theme.colors.success,
  },
  diagramStatusFailed: {
    color: theme.colors.statusDanger,
  },
  diagramDuration: {
    minWidth: 48,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  diagramError: {
    marginLeft: 22,
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  anchorStep: {
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface0,
  },
  anchorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  anchorTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  anchorList: {
    maxHeight: 168,
  },
  anchorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  anchorRowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  anchorKind: {
    minWidth: 74,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  anchorMain: {
    flex: 1,
    minWidth: 0,
  },
  anchorLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  anchorDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  anchorActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  generationTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  typeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  typeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  typeOptionSelected: {
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface2,
  },
  typeOptionReady: {
    borderColor: theme.colors.success,
  },
  typeOptionText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  formInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    fontSize: theme.fontSize.sm,
  },
  requestInput: {
    minHeight: 48,
    textAlignVertical: "top",
  },
  generateButton: {
    minWidth: 88,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.accent,
  },
  generateButtonDisabled: {
    opacity: 0.45,
  },
  generateText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  preview: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  centeredTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  centeredText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  mutedColor: {
    color: theme.colors.foregroundMuted,
  },
  activeColor: {
    color: theme.colors.foreground,
  },
  activeText: {
    color: theme.colors.foreground,
  },
}));

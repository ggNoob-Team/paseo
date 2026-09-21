import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
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
  buildArchifyFocusScript,
  buildArchifyGenerationPrompt,
  buildArchifySearchEntries,
  filterArchifySearchEntries,
  latestArchifyArtifactByType,
  resolveArchifyAgentConfig,
  type ArchifySearchEntry,
} from "@/archify/model";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { FileHtmlPreview } from "@/file-pane/html-preview";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { ArchifyArtifactSummary, ArchifyDiagramType } from "@getpaseo/protocol/messages";

interface ArchifyGenerationState {
  agentId: string;
  types: readonly ArchifyDiagramType[];
}

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
  onSelect,
}: {
  artifact: ArchifyArtifactSummary;
  active: boolean;
  label: string;
  onSelect: (artifactId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(artifact.id), [artifact.id, onSelect]);
  return (
    <Pressable
      onPress={handlePress}
      style={[styles.artifactTab, active && styles.artifactTabActive]}
    >
      <DiagramTypeIcon
        type={artifact.type}
        size={14}
        color={active ? styles.activeColor.color : styles.mutedColor.color}
      />
      <Text style={[styles.artifactTabText, active && styles.activeText]}>{label}</Text>
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

// eslint-disable-next-line complexity
function ArchifyPanel(): ReactElement {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "archify", "ArchifyPanel requires archify target");
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "archify");
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
  const [generation, setGeneration] = useState<ArchifyGenerationState | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [command, setCommand] = useState<ArchifyPreviewCommand | null>(null);
  const [request, setRequest] = useState("");
  const [scope, setScope] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<ArchifyDiagramType[]>([
    ...ARCHIFY_INITIAL_TYPES,
  ]);
  const autoStartedRef = useRef(false);
  const skillReadyRef = useRef(false);
  const previousGenerationRunningRef = useRef(false);

  const generationAgentStatus = useSessionStore((state) =>
    generation ? (state.sessions[serverId]?.agents.get(generation.agentId)?.status ?? null) : null,
  );
  const generationAgentError = useSessionStore((state) =>
    generation
      ? (state.sessions[serverId]?.agents.get(generation.agentId)?.lastError ?? null)
      : null,
  );
  const generationRunning =
    generationAgentStatus === "initializing" || generationAgentStatus === "running";

  const workspaceQuery = useFetchQuery({
    queryKey: ["archify", "workspace", serverId, workspaceId],
    queryFn: () => {
      if (!client) throw new Error("Archify host is offline");
      return client.openArchifyWorkspace(workspaceId);
    },
    enabled: Boolean(client && supported && workspaceId),
    refetchInterval: isStarting || generationRunning ? 2500 : false,
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

  const startGeneration = useCallback(
    async (input?: { types?: readonly ArchifyDiagramType[]; request?: string; scope?: string }) => {
      if (!client || !agentConfig || !workspaceDirectory || isStarting) return;
      const types = input?.types?.length ? input.types : ARCHIFY_INITIAL_TYPES;
      setIsStarting(true);
      setGenerationError(null);
      try {
        if (!skillReadyRef.current) {
          await ensureArchifySkill({ client, skillManagement });
          skillReadyRef.current = true;
        }
        const artifactPrefix = `archify-${Date.now().toString(36)}`;
        const created = await client.createAgent({
          provider: agentConfig.provider,
          ...(agentConfig.model ? { model: agentConfig.model } : {}),
          ...(agentConfig.modeId ? { modeId: agentConfig.modeId } : {}),
          cwd: workspaceDirectory,
          workspaceId,
          title: "Archify",
          initialPrompt: buildArchifyGenerationPrompt({
            artifactPrefix,
            types,
            request: input?.request,
            scope: input?.scope,
          }),
          labels: { "paseo.archify.generator": "true" },
        });
        setGeneration({ agentId: created.id, types });
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
    setSelectedArtifactId(artifactId);
    setCommand(null);
  }, []);

  const handleGenerate = useCallback(() => {
    void startGeneration({ types: selectedTypes, request, scope });
  }, [request, scope, selectedTypes, startGeneration]);

  if (!client) return <UnavailableState message={t("workspace.terminal.hostDisconnected")} />;
  if (!supported) return <UnavailableState message={t("archify.unavailable")} />;
  if (!workspaceDirectory) {
    return <UnavailableState message={t("panels.file.directoryMissing")} />;
  }

  const generating = isStarting || generationRunning;
  const currentGenerationError = generationError ?? generationAgentError;
  let statusText = t("archify.ready");
  if (generating) statusText = t("archify.generating");
  if (currentGenerationError) statusText = t("archify.generationFailed");

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {artifacts.map((item) => (
            <ArchifyArtifactTab
              key={item.id}
              artifact={item}
              active={item.id === selectedArtifactId}
              label={t(`archify.types.${item.type}`)}
              onSelect={handleSelectArtifact}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.generationPanel}>
        <View style={styles.generationHeader}>
          <Text style={styles.generationTitle}>{statusText}</Text>
          {generating ? <ActivityIndicator size="small" /> : null}
        </View>
        {currentGenerationError ? (
          <Text style={styles.errorText}>{currentGenerationError}</Text>
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
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  artifactTab: {
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

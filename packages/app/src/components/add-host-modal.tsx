import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Link2 } from "lucide-react-native";
import {
  relayConnectionFromOffer,
  type HostConnection,
  type HostProfile,
} from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import {
  parseConnectionUri,
  parseRelayConnectionUri,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
  serializeRelayConnectionUri,
} from "@/utils/daemon-endpoints";
import { buildConnectionFailureCopy } from "./connection-failure-copy";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PairingTargetTracker } from "./pair-link-credentials";

const FLEX_ONE_STYLE = { flex: 1 } as const;

interface DirectConnectionDraft {
  host: string;
  port: string;
  useTls: boolean;
  password: string;
}

interface PreparedDirectConnection {
  uri: string;
  endpoint: string;
  useTls: boolean;
  password?: string;
}

interface DirectConnectionLabels {
  hostRequired: string;
  invalidPort: string;
  invalidConnection: string;
  failedToConnect: (endpoint: string) => string;
  noAdditionalDetails: (detail: string) => string;
  timedOut: string;
  refused: string;
  hostNotFound: string;
  hostUnreachable: string;
  tlsError: string;
  unableToConnect: string;
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  portRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  hostField: {
    flex: 1,
    minWidth: 0,
  },
  portField: {
    width: 112,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
  },
  advancedText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
}));

function isIpv6Host(host: string): boolean {
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]");
}

function buildConnectionUriFromDraft(
  draft: DirectConnectionDraft,
  labels: DirectConnectionLabels,
): string {
  const host = draft.host.trim();
  const port = Number(draft.port.trim());
  if (!host) {
    throw new Error(labels.hostRequired);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(labels.invalidPort);
  }

  return serializeConnectionUriForStorage({
    host,
    port,
    isIpv6: isIpv6Host(host),
    useTls: draft.useTls,
    ...(draft.password ? { password: draft.password } : {}),
  });
}

function prepareDirectConnection(
  draft: DirectConnectionDraft,
  labels: DirectConnectionLabels,
): PreparedDirectConnection {
  const parsed = parseConnectionUri(buildConnectionUriFromDraft(draft, labels));
  const endpoint = parsed.isIpv6
    ? `[${parsed.host}]:${parsed.port}`
    : `${parsed.host}:${parsed.port}`;

  return {
    uri: serializeConnectionUri(parsed),
    endpoint,
    useTls: parsed.useTls,
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

function formatDirectConnectionFailure(input: {
  error: unknown;
  endpoint: string;
  labels: DirectConnectionLabels;
  t: TFunction;
}): string {
  const {
    title,
    detail,
    raw: rawDetail,
  } = buildConnectionFailureCopy({
    endpoint: input.endpoint,
    error: input.error,
    labels: input.labels,
  });
  if (rawDetail && detail && rawDetail !== detail) {
    return `${title}\n${detail}\n${input.t("pairing.direct.errors.details", {
      detail: rawDetail,
    })}`;
  }
  if (detail) {
    return `${title}\n${detail}`;
  }
  return title;
}

function draftFromConnectionUri(uri: string): DirectConnectionDraft {
  const parsed = parseConnectionUri(uri);
  return {
    host: parsed.host,
    port: String(parsed.port),
    useTls: parsed.useTls,
    password: parsed.password ?? "",
  };
}

interface InitialHostState {
  draft: DirectConnectionDraft;
  relayUri: string | null;
  connectionId: string | null;
}

function resolveInitialHostState(host: HostProfile | undefined): InitialHostState {
  const emptyDraft: DirectConnectionDraft = {
    host: "",
    port: "6767",
    useTls: false,
    password: host?.password ?? "",
  };
  if (!host) {
    return { draft: emptyDraft, relayUri: null, connectionId: null };
  }

  const preferred = host.connections.find(
    (connection) => connection.id === host.preferredConnectionId,
  );
  const direct =
    preferred?.type === "directTcp"
      ? preferred
      : host.connections.find((connection) => connection.type === "directTcp");
  if (direct) {
    try {
      const parsed = parseConnectionUri(`tcp://${direct.endpoint}`);
      return {
        draft: {
          host: parsed.host,
          port: String(parsed.port),
          useTls: parsed.useTls,
          password: host.password ?? "",
        },
        relayUri: null,
        connectionId: direct.id,
      };
    } catch {
      return { draft: emptyDraft, relayUri: null, connectionId: direct.id };
    }
  }

  const relay =
    preferred?.type === "relay"
      ? preferred
      : host.connections.find((connection) => connection.type === "relay");
  if (relay) {
    return {
      draft: emptyDraft,
      relayUri: serializeRelayConnectionUri({
        offer: {
          v: 2,
          serverId: host.serverId,
          daemonPublicKeyB64: relay.daemonPublicKeyB64,
          relay: { endpoint: relay.relayEndpoint, useTls: relay.useTls ?? false },
        },
      }),
      connectionId: relay.id,
    };
  }

  return { draft: emptyDraft, relayUri: null, connectionId: null };
}

export interface AddHostModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  initialHost?: HostProfile;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function AddHostModal({
  visible,
  onClose,
  onCancel,
  initialHost,
  onSaved,
}: AddHostModalProps) {
  return (
    <AddHostModalContent
      key={`${String(visible)}:${initialHost?.serverId ?? ""}`}
      visible={visible}
      onClose={onClose}
      onCancel={onCancel}
      initialHost={initialHost}
      onSaved={onSaved}
    />
  );
}

function AddHostModalContent({
  visible,
  onClose,
  onCancel,
  initialHost,
  onSaved,
}: AddHostModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const daemons = useHosts();
  const { probeAndUpsertDirectConnection, probeAndUpdateHostConnection, beginLinkPairing } =
    useHostMutations();
  const [linkPairing] = useState(() => beginLinkPairing());
  const isMobile = useIsCompactFormFactor();
  const initialState = useMemo(() => resolveInitialHostState(initialHost), [initialHost]);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [host, setHost] = useState(initialState.draft.host);
  const [port, setPort] = useState(initialState.draft.port);
  const [useTls, setUseTls] = useState(initialState.draft.useTls);
  const [password, setPassword] = useState(initialState.draft.password);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(initialState.relayUri !== null);
  const [advancedUri, setAdvancedUri] = useState(initialState.relayUri ?? "");
  const [inputResetKey, bumpInputResetKey] = useReducer((key: number) => key + 1, 0);
  const advancedTarget = useRef(new PairingTargetTracker(initialState.relayUri ?? "", true));

  const connectIcon = useMemo(
    () => <Link2 size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );
  const hostFieldStyle = useMemo(() => [styles.field, styles.hostField], []);
  const portFieldStyle = useMemo(() => [styles.field, styles.portField], []);
  const checkboxStyle = useMemo(
    () => [styles.checkbox, useTls ? styles.checkboxChecked : null],
    [useTls],
  );
  const passwordInputStyle = useMemo(() => [styles.input, styles.passwordInput], []);
  const useTlsAccessibilityState = useMemo(
    () => ({ checked: useTls, disabled: isSaving }),
    [isSaving, useTls],
  );
  const directConnectionLabels = useMemo<DirectConnectionLabels>(
    () => ({
      hostRequired: t("pairing.direct.errors.hostRequired"),
      invalidPort: t("pairing.direct.errors.invalidPort"),
      invalidConnection: t("pairing.direct.errors.invalidConnection"),
      failedToConnect: (endpoint) => t("pairing.direct.errors.failedToConnect", { endpoint }),
      noAdditionalDetails: (detail) => t("pairing.direct.errors.noAdditionalDetails", { detail }),
      timedOut: t("pairing.direct.errors.timedOut"),
      refused: t("pairing.direct.errors.refused"),
      hostNotFound: t("pairing.direct.errors.hostNotFound"),
      hostUnreachable: t("pairing.direct.errors.hostUnreachable"),
      tlsError: t("pairing.direct.errors.tlsError"),
      unableToConnect: t("pairing.direct.errors.unableToConnect"),
    }),
    [t],
  );
  const isUpdateHost = initialHost !== undefined;
  const header = useMemo<SheetHeader>(
    () => ({
      title: isUpdateHost ? t("settings.host.connectionUpdate.title") : t("pairing.direct.title"),
    }),
    [isUpdateHost, t],
  );

  // Each open mounts a fresh form (see AddHostModal), so closing needs no reset.
  const handleClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    (onCancel ?? onClose)();
  }, [isSaving, onCancel, onClose]);

  const handleSaveRelay = useCallback(
    async (relayUri: string) => {
      try {
        setIsSaving(true);
        setErrorMessage("");
        const result = await linkPairing.submit(relayUri, password || undefined);
        if (result.status === "cancelled") return;
        const { profile, serverId, hostname } = result;
        const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);
        onSaved?.({ profile, serverId, hostname, isNewHost });
        handleClose();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : directConnectionLabels.invalidConnection,
        );
      } finally {
        setIsSaving(false);
      }
    },
    [
      daemons,
      directConnectionLabels.invalidConnection,
      handleClose,
      linkPairing,
      onSaved,
      password,
    ],
  );

  const handleUpdateHost = useCallback(async () => {
    if (!initialHost || isSaving) return;

    const relayUri = isAdvancedOpen ? advancedUri.trim() : "";
    const isRelayLink = relayUri.startsWith("relay://") || relayUri.includes("#connect=");
    let connection: HostConnection | null = null;
    let preparedUri: string | null = null;
    let passwordOverride = password;

    try {
      if (isRelayLink) {
        const parsed = parseRelayConnectionUri(relayUri);
        connection = relayConnectionFromOffer(parsed.offer);
        passwordOverride = password || parsed.password || "";
      } else {
        const prepared = prepareDirectConnection(
          { host, port, useTls, password },
          directConnectionLabels,
        );
        preparedUri = prepared.uri;
        connection = {
          id: `direct:${prepared.endpoint}`,
          type: "directTcp",
          endpoint: prepared.endpoint,
          useTls: prepared.useTls,
        };
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : directConnectionLabels.invalidConnection,
      );
      return;
    }

    if (!connection) return;

    try {
      setIsSaving(true);
      setErrorMessage("");
      const result = await probeAndUpdateHostConnection({
        serverId: initialHost.serverId,
        connection,
        password: passwordOverride,
        ...(initialState.connectionId ? { replaceConnectionId: initialState.connectionId } : {}),
      });
      onSaved?.({ ...result, isNewHost: false });
      handleClose();
    } catch (error) {
      if ((error as { code?: string }).code === "host_update_target_mismatch") {
        setErrorMessage(t("settings.host.connectionUpdate.differentHost"));
        return;
      }
      if (preparedUri) {
        const combined = formatDirectConnectionFailure({
          error,
          endpoint: preparedUri,
          labels: directConnectionLabels,
          t,
        });
        setErrorMessage(combined);
        if (!isMobile) {
          Alert.alert(t("pairing.direct.errors.failedTitle"), combined);
        }
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : t("common.errors.unableToSave"));
    } finally {
      setIsSaving(false);
    }
  }, [
    advancedUri,
    directConnectionLabels,
    handleClose,
    host,
    initialHost,
    initialState.connectionId,
    isAdvancedOpen,
    isMobile,
    isSaving,
    onSaved,
    password,
    port,
    probeAndUpdateHostConnection,
    t,
    useTls,
  ]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    if (initialHost) {
      await handleUpdateHost();
      return;
    }

    const relayUri = isAdvancedOpen ? advancedUri.trim() : "";
    if (relayUri.startsWith("relay://") || relayUri.includes("#connect=")) {
      await handleSaveRelay(relayUri);
      return;
    }

    let connection: PreparedDirectConnection;
    try {
      connection = prepareDirectConnection(
        { host, port, useTls, password },
        directConnectionLabels,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : directConnectionLabels.invalidConnection;
      setErrorMessage(message);
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { profile, serverId, hostname } = await probeAndUpsertDirectConnection({
        endpoint: connection.endpoint,
        useTls: connection.useTls,
        ...(connection.password ? { password: connection.password } : {}),
      });
      const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);

      onSaved?.({ profile, serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const combined = formatDirectConnectionFailure({
        error,
        endpoint: connection.uri,
        labels: directConnectionLabels,
        t,
      });
      setErrorMessage(combined);
      if (!isMobile) {
        Alert.alert(t("pairing.direct.errors.failedTitle"), combined);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    advancedUri,
    daemons,
    directConnectionLabels,
    handleClose,
    handleUpdateHost,
    host,
    initialHost,
    isAdvancedOpen,
    isMobile,
    isSaving,
    onSaved,
    password,
    port,
    probeAndUpsertDirectConnection,
    t,
    handleSaveRelay,
    useTls,
  ]);

  const handleSubmitEditing = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleChangeAdvancedUri = useCallback((next: string) => {
    if (advancedTarget.current.changeUrl(next)) {
      setPassword("");
      bumpInputResetKey();
      setErrorMessage("");
    }
    setAdvancedUri(next);
  }, []);

  const handleToggleUseTls = useCallback(() => {
    if (isSaving) return;
    setUseTls((current) => !current);
  }, [isSaving]);

  const handleTogglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((current) => !current);
  }, []);

  const handleToggleAdvanced = useCallback(() => {
    if (!isAdvancedOpen) {
      advancedTarget.current = new PairingTargetTracker("", true);
      try {
        setAdvancedUri(
          buildConnectionUriFromDraft({ host, port, useTls, password }, directConnectionLabels),
        );
      } catch {
        setAdvancedUri("");
      }
      setErrorMessage("");
      setIsAdvancedOpen(true);
      return;
    }

    try {
      const next = draftFromConnectionUri(advancedUri);
      setHost(next.host);
      setPort(next.port);
      setUseTls(next.useTls);
      setPassword(next.password);
      setErrorMessage("");
      bumpInputResetKey();
    } catch {
      setErrorMessage("");
    }
    setIsAdvancedOpen(false);
  }, [advancedUri, directConnectionLabels, host, isAdvancedOpen, password, port, useTls]);

  const AdvancedIcon = isAdvancedOpen ? ChevronDown : ChevronRight;
  const PasswordIcon = isPasswordVisible ? EyeOff : Eye;
  const submitLabel = (() => {
    if (isSaving) {
      return isUpdateHost
        ? t("settings.host.connectionUpdate.updating")
        : t("pairing.direct.actions.connecting");
    }
    return isUpdateHost
      ? t("settings.host.connectionUpdate.button")
      : t("pairing.direct.actions.connect");
  })();

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="add-host-modal"
    >
      <Text style={styles.helper}>
        {isUpdateHost ? t("settings.host.connectionUpdate.modalHint") : t("pairing.direct.helper")}
      </Text>

      <View style={styles.portRow}>
        <View style={hostFieldStyle}>
          <Text style={styles.label}>{t("pairing.direct.fields.host")}</Text>
          <AdaptiveTextInput
            testID="direct-host-input"
            nativeID="direct-host-input"
            accessibilityLabel={t("pairing.direct.fields.host")}
            initialValue={host}
            resetKey={`direct-host-${inputResetKey}`}
            onChangeText={setHost}
            placeholder="localhost"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isSaving}
            returnKeyType="next"
          />
        </View>
        <View style={portFieldStyle}>
          <Text style={styles.label}>{t("pairing.direct.fields.port")}</Text>
          <AdaptiveTextInput
            testID="direct-port-input"
            nativeID="direct-port-input"
            accessibilityLabel={t("pairing.direct.fields.port")}
            initialValue={port}
            resetKey={`direct-port-${inputResetKey}`}
            onChangeText={setPort}
            placeholder="6767"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
          />
        </View>
      </View>

      <Pressable
        style={styles.checkboxRow}
        onPress={handleToggleUseTls}
        disabled={isSaving}
        accessibilityRole="checkbox"
        accessibilityLabel={t("pairing.direct.fields.useSsl")}
        accessibilityState={useTlsAccessibilityState}
        testID="direct-ssl-toggle"
      >
        <View style={checkboxStyle}>
          {useTls ? (
            <View testID="direct-ssl-toggle-checked">
              <Check size={14} color={theme.colors.accentForeground} />
            </View>
          ) : null}
        </View>
        <Text style={styles.label}>{t("pairing.direct.fields.useSsl")}</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.direct.fields.password")}</Text>
        <View style={styles.passwordRow}>
          <AdaptiveTextInput
            testID="direct-password-input"
            nativeID="direct-password-input"
            accessibilityLabel={t("pairing.direct.fields.password")}
            initialValue={password}
            resetKey={`direct-password-${inputResetKey}`}
            onChangeText={setPassword}
            placeholder={t("pairing.direct.fields.optional")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={passwordInputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!isPasswordVisible}
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
          />
          <Pressable
            style={styles.iconButton}
            onPress={handleTogglePasswordVisibility}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={
              isPasswordVisible
                ? t("pairing.direct.passwordVisibility.hide")
                : t("pairing.direct.passwordVisibility.show")
            }
            testID="direct-password-visibility-toggle"
          >
            <PasswordIcon size={18} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Pressable
          style={styles.advancedToggle}
          onPress={handleToggleAdvanced}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={
            isAdvancedOpen ? t("pairing.direct.advanced.hide") : t("pairing.direct.advanced.show")
          }
          testID="direct-host-advanced-toggle"
        >
          <AdvancedIcon size={16} color={theme.colors.foregroundMuted} />
          <Text style={styles.advancedText}>{t("pairing.direct.advanced.label")}</Text>
        </Pressable>
        {isAdvancedOpen ? (
          <AdaptiveTextInput
            testID="direct-host-uri-input"
            nativeID="direct-host-uri-input"
            accessibilityLabel={t("pairing.direct.fields.connectionUri")}
            initialValue={advancedUri}
            resetKey={`direct-host-uri-${inputResetKey}`}
            onChangeText={handleChangeAdvancedUri}
            placeholder="tcp://localhost:6767?ssl=true"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleToggleAdvanced}
          />
        ) : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
        >
          {t("pairing.direct.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          leftIcon={connectIcon}
          testID="direct-host-submit"
        >
          {submitLabel}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

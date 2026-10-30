import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

interface TerminalModelSelectorProps {
  serverId: string;
  providers: ProviderSelectorProvider[];
  selectedProvider: AgentProvider | null;
  selectedModel: string;
  isLoading: boolean;
  disabled: boolean;
  onSelect: (provider: AgentProvider, modelId: string) => void;
}

const MODEL_TOOLBAR: { glyphSize: number; showCaret: boolean } = {
  glyphSize: 16,
  showCaret: true,
};

/**
 * The terminal operator is its own agent, so the picker uses the same
 * provider/model form logic as creating a project agent instead of reading or
 * mutating the workspace's focused agent.
 */
export function TerminalModelSelector({
  serverId,
  providers,
  selectedProvider,
  selectedModel,
  isLoading,
  disabled,
  onSelect,
}: TerminalModelSelectorProps) {
  return (
    <View style={styles.root} testID="terminal-agent-prompt-model">
      <CombinedModelSelector
        providers={providers}
        selectedProvider={selectedProvider ?? ""}
        selectedModel={selectedModel}
        onSelect={onSelect}
        isLoading={isLoading}
        disabled={disabled || !selectedProvider}
        serverId={serverId}
        desktopPlacement="top-start"
        desktopMinWidth={320}
        toolbar={MODEL_TOOLBAR}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    minWidth: 0,
    maxWidth: "45%",
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: theme.spacing[1],
  },
}));

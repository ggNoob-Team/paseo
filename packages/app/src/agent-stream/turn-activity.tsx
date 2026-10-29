import { ExpandableBadge } from "@/components/message";
import { getTurnDurationLabel } from "@/components/assistant-turn-footer-label";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { Theme } from "@/styles/theme";
import type { StreamItem, TurnActivityItem } from "@/types/stream";
import { ChevronRight, Terminal } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { groupTurnActivityBlocks, type ShellToolCallItem } from "./turn-activity-blocks";

const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const activeIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

interface TurnActivityProps {
  item: TurnActivityItem;
  renderItem: (item: StreamItem) => ReactNode;
  renderShellItem: (item: ShellToolCallItem) => ReactNode;
}

/**
 * Collapsed summary for a completed turn. Expanding reveals the turn's commentary
 * and tool rows in their original order, without rendering raw reasoning text.
 */
export const TurnActivity = memo(function TurnActivity({
  item,
  renderItem,
  renderShellItem,
}: TurnActivityProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const canExpand = item.items.length > 0;
  const blocks = useMemo(() => groupTurnActivityBlocks(item.items), [item.items]);
  const durationLabel = useMemo(
    () => getTurnDurationLabel(item.durationMs, t),
    [item.durationMs, t],
  );

  const handleToggle = useCallback(() => {
    if (canExpand) {
      setExpanded((previous) => !previous);
    }
  }, [canExpand]);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const active = hovered || expanded;
  const accessibilityState = useMemo(
    () => (canExpand ? { expanded } : undefined),
    [canExpand, expanded],
  );

  return (
    <View style={stylesheet.container} testID="turn-activity">
      <PressHighlight
        testID="turn-activity-toggle"
        disabled={!canExpand}
        onPress={handleToggle}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityState={accessibilityState}
        accessibilityLabel={durationLabel}
        highlightStyle={stylesheet.summaryPressed}
        style={stylesheet.summaryPressable}
      >
        <Text style={[stylesheet.label, active && stylesheet.labelActive]}>{durationLabel}</Text>
        {canExpand ? (
          <View style={[stylesheet.chevron, expanded && stylesheet.chevronExpanded]}>
            <ThemedChevronRight
              size={12}
              uniProps={active ? activeIconColorMapping : mutedIconColorMapping}
            />
          </View>
        ) : null}
      </PressHighlight>
      {expanded && canExpand ? (
        <View style={stylesheet.details} testID="turn-activity-details">
          {blocks.map((block) =>
            block.kind === "shell_group" ? (
              <ShellCommandGroup key={block.id} items={block.items} renderItem={renderShellItem} />
            ) : (
              <View key={block.item.id} style={stylesheet.detailRow}>
                {renderItem(block.item)}
              </View>
            ),
          )}
        </View>
      ) : null}
    </View>
  );
});

interface ShellCommandGroupProps {
  items: ShellToolCallItem[];
  renderItem: (item: ShellToolCallItem) => ReactNode;
}

/**
 * Consecutive shell calls collapse into a single "Ran command" row. Expanding it
 * lists each command, and every row still opens its own output on demand.
 */
const ShellCommandGroup = memo(function ShellCommandGroup({
  items,
  renderItem,
}: ShellCommandGroupProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => setExpanded((previous) => !previous), []);
  const renderDetails = useCallback(
    () => (
      <View style={stylesheet.shellList}>
        {items.map((child) => (
          <View key={child.id} style={stylesheet.shellListRow}>
            {renderItem(child)}
          </View>
        ))}
      </View>
    ),
    [items, renderItem],
  );

  return (
    <ExpandableBadge
      testID="turn-activity-shell-group"
      label={t("agentStream.turnActivity.ranCommand")}
      icon={Terminal}
      isExpanded={expanded}
      onToggle={handleToggle}
      renderDetails={renderDetails}
      isLastInSequence={expanded}
    />
  );
});

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingTop: theme.spacing[1],
  },
  summaryPressable: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.sm,
  },
  summaryPressed: {
    opacity: 0.65,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  chevron: {
    flexShrink: 0,
    transform: [{ rotate: "0deg" }],
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  details: {
    marginTop: theme.spacing[1],
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  detailRow: {
    minWidth: 0,
  },
  shellList: {
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  shellListRow: {
    minWidth: 0,
  },
}));

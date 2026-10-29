import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem, TurnActivityItem, UserMessageItem } from "@/types/stream";
import { startsNewTurn } from "./turn-membership";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  level: ToolCallDetailLevel;
  isTurnActive: boolean;
}

/** Find and scrolling address a plugin row by the source it replaces. */
export function getStreamItemMessageId(item: StreamItem): string {
  if (item.kind === "plugin") return item.sourceId ?? item.id;
  return item.id;
}

function isTurnActivityDetail(item: StreamItem): boolean {
  if (item.kind === "thought" || item.kind === "user_message" || item.kind === "turn_activity") {
    return false;
  }
  if (item.kind === "assistant_message") {
    return item.text.trim().length > 0;
  }
  return true;
}

function foldCompletedTurn(segment: StreamItem[]): StreamItem[] | null {
  const first = segment[0];
  if (first?.kind !== "user_message") {
    return null;
  }

  let finalIndex = -1;
  for (let index = segment.length - 1; index >= 1; index -= 1) {
    const item = segment[index];
    if (item?.kind === "assistant_message" && item.text.trim().length > 0) {
      finalIndex = index;
      break;
    }
  }
  if (finalIndex <= 1) {
    return null;
  }

  const final = segment[finalIndex];
  if (final?.kind !== "assistant_message") {
    return null;
  }

  const details = segment.slice(1, finalIndex).filter(isTurnActivityDetail);
  const trailing = segment.slice(finalIndex + 1).filter((item) => item.kind !== "thought");
  const turnId =
    first.turnId !== undefined && first.turnId === final.turnId ? first.turnId : undefined;
  const activity: TurnActivityItem = {
    kind: "turn_activity",
    id: `turn-activity:${first.id}`,
    ...(turnId ? { turnId } : {}),
    timestamp: final.timestamp,
    durationMs: Math.max(0, final.timestamp.getTime() - first.timestamp.getTime()),
    assistantItemId: final.id,
    items: details,
  };
  return [first, activity, final, ...trailing];
}

const completedTurnGroupingCache = new WeakMap<StreamItem[], StreamItem[]>();

/**
 * Folds each completed user turn into one summary row followed by its final answer.
 * The process rows live inside that summary so they keep their chronological order.
 * A slice that begins mid-turn is left untouched because there is no complete turn
 * to summarize.
 */
export function groupCompletedTurns(items: StreamItem[]): StreamItem[] {
  const cached = completedTurnGroupingCache.get(items);
  if (cached) return cached;

  const output: StreamItem[] = [];
  let changed = false;
  let start = 0;
  for (let index = 1; index <= items.length; index += 1) {
    const isBoundary =
      index === items.length || startsNewTurn(items[index], items[index - 1] ?? null);
    if (!isBoundary) continue;
    const segment = items.slice(start, index);
    const folded = foldCompletedTurn(segment);
    if (folded) {
      output.push(...folded);
      changed = true;
    } else {
      output.push(...segment);
    }
    start = index;
  }

  const result = changed ? output : items;
  completedTurnGroupingCache.set(items, result);
  return result;
}

/** Source messages reach plugins before display projection. */
export function createStreamPresentation() {
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;

    // Recognize the complete voice envelope, including older messages without the
    // instruction suffix. Leave quoted examples and unrelated XML untouched.
    const spokenInput =
      /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/.exec(
        item.text,
      );
    const projected = spokenInput ? { ...item, text: spokenInput[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  let historySource: StreamItem[] | undefined;
  let historyTransform: TimelineItemTransform | undefined;
  let historyRows: StreamItem[] = [];
  let preparedTail: StreamItem[] | undefined;
  let preparedLevel: ToolCallDetailLevel | undefined;
  let preparedHistory: PreparedToolCallHistory | null = null;

  function presentRows(item: StreamItem): StreamItem[] {
    return [item.kind === "user_message" ? presentUserMessage(item) : item];
  }

  return (input: PresentationInput) => {
    // Retained history is not reprojected or regrouped on each live text update.
    if (historySource !== input.tail || historyTransform !== input.transform) {
      historyRows = projectPluginTimelineItems(input.tail, input.transform).flatMap<StreamItem>(
        (item) => presentRows(item),
      );
      historySource = input.tail;
      historyTransform = input.transform;
    }
    const head: StreamItem[] = [];
    for (const item of projectPluginTimelineItems(input.head, input.transform, "streaming")) {
      const blocks = presentRows(item);
      head.push(...blocks);
    }
    if (preparedTail !== historyRows || preparedLevel !== input.level) {
      preparedHistory = prepareToolCallHistory(input.level, historyRows);
      preparedTail = historyRows;
      preparedLevel = input.level;
    }
    const projected = projectToolCallDetailLevel({
      level: input.level,
      tail: historyRows,
      head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
    });
    const tail = groupCompletedTurns(projected.tail);
    const projectedHead = input.isTurnActive ? projected.head : groupCompletedTurns(projected.head);
    return tail === projected.tail && projectedHead === projected.head
      ? projected
      : { ...projected, tail, head: projectedHead };
  };
}

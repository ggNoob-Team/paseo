import type { StreamItem } from "@/types/stream";

export type ShellToolCallItem = Extract<StreamItem, { kind: "tool_call" }>;

export type TurnActivityBlock =
  | { kind: "item"; item: StreamItem }
  | { kind: "shell_group"; id: string; items: ShellToolCallItem[] };

const SHELL_TOOL_NAMES = new Set(["shell", "bash", "terminal"]);

export function isShellToolCallItem(item: StreamItem): item is ShellToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const { payload } = item;
  return payload.source === "agent"
    ? payload.data.detail.type === "shell"
    : SHELL_TOOL_NAMES.has(payload.data.toolName.trim().toLowerCase());
}

/** The exact command to put on the clipboard for a shell row, when known. */
export function getShellCommandText(item: ShellToolCallItem): string | null {
  const { payload } = item;
  if (payload.source === "agent") {
    return payload.data.detail.type === "shell" ? payload.data.detail.command : null;
  }
  const { arguments: args } = payload.data;
  if (typeof args !== "object" || args === null) {
    return null;
  }
  const command = Reflect.get(args, "command");
  return typeof command === "string" && command.trim().length > 0 ? command : null;
}

/**
 * Consecutive shell calls read as one "Ran command" step, matching how other
 * chat clients collapse an execution streak. Commentary or a different tool
 * splits the streak so the transcript keeps its original order.
 */
export function groupTurnActivityBlocks(items: StreamItem[]): TurnActivityBlock[] {
  const blocks: TurnActivityBlock[] = [];
  let shellItems: ShellToolCallItem[] = [];

  const flushShellItems = () => {
    const first = shellItems[0];
    if (!first) return;
    blocks.push({ kind: "shell_group", id: `shell-group:${first.id}`, items: shellItems });
    shellItems = [];
  };

  for (const item of items) {
    if (isShellToolCallItem(item)) {
      shellItems.push(item);
      continue;
    }
    flushShellItems();
    blocks.push({ kind: "item", item });
  }
  flushShellItems();

  return blocks;
}

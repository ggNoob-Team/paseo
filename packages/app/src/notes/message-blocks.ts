import { createMarkdownParser } from "@/utils/markdown-parser";

/**
 * One top-level markdown block of a message: a paragraph, heading, list, code
 * fence, table, or quote — the unit a person points at when they say "this
 * part". Native text selection cannot cross those boundaries on a phone
 * (each block is its own native text node), so notes are captured by picking
 * blocks instead of by dragging selection handles.
 */
export interface MessageBlock {
  id: string;
  text: string;
}

const markdownParser = createMarkdownParser({ linkify: true });

/** Blocks that carry no content of their own; there is nothing to keep. */
const CONTENTLESS_BLOCK_TYPES = new Set(["hr"]);

export function splitMessageIntoBlocks(markdown: string): MessageBlock[] {
  const trimmed = markdown.trim();
  if (trimmed.length === 0) return [];

  const lines = markdown.split("\n");
  const blocks: MessageBlock[] = [];
  const tokens = markdownParser.parse(markdown, {});
  for (const token of tokens) {
    // Top-level only: a list or quote is one block, not its every child.
    if (token.level !== 0 || token.nesting === -1) continue;
    if (!token.map || CONTENTLESS_BLOCK_TYPES.has(token.type)) continue;
    const text = lines.slice(token.map[0], token.map[1]).join("\n").trim();
    if (text.length === 0) continue;
    blocks.push({ id: `block_${blocks.length}`, text });
  }

  // A message that is only whitespace-ish markdown keeps its raw text rather
  // than turning into an empty picker.
  if (blocks.length === 0 && trimmed.length > 0) {
    return [{ id: "block_0", text: trimmed }];
  }
  return blocks;
}

export function joinSelectedBlocks(
  blocks: readonly MessageBlock[],
  selectedIds: ReadonlySet<string>,
): string {
  return blocks
    .filter((block) => selectedIds.has(block.id))
    .map((block) => block.text)
    .join("\n\n");
}

export function selectAllBlockIds(blocks: readonly MessageBlock[]): Set<string> {
  return new Set(blocks.map((block) => block.id));
}

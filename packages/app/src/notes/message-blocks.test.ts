import { describe, expect, test } from "vitest";
import { joinSelectedBlocks, selectAllBlockIds, splitMessageIntoBlocks } from "./message-blocks";

describe("splitMessageIntoBlocks", () => {
  test("splits a message into its top-level blocks", () => {
    const blocks = splitMessageIntoBlocks(
      [
        "# Title",
        "",
        "First paragraph with **bold**.",
        "",
        "- item one",
        "- item two",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "> quoted",
        "",
        "Last words.",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.text)).toEqual([
      "# Title",
      "First paragraph with **bold**.",
      "- item one\n- item two",
      "```ts\nconst a = 1;\n```",
      "> quoted",
      "Last words.",
    ]);
    expect(blocks.map((block) => block.id)).toEqual([
      "block_0",
      "block_1",
      "block_2",
      "block_3",
      "block_4",
      "block_5",
    ]);
  });

  test("keeps a short list and a table as single blocks", () => {
    const blocks = splitMessageIntoBlocks(
      ["1. one", "2. two", "", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n"),
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toBe("1. one\n2. two");
    expect(blocks[1]?.text).toContain("| 1 | 2 |");
  });

  test("drops separators, which hold nothing to keep", () => {
    const blocks = splitMessageIntoBlocks(["before", "", "---", "", "after"].join("\n"));
    expect(blocks.map((block) => block.text)).toEqual(["before", "after"]);
  });

  test("treats empty input as no blocks", () => {
    expect(splitMessageIntoBlocks("   \n  ")).toEqual([]);
  });

  test("falls back to the raw text when the parser finds no block", () => {
    const blocks = splitMessageIntoBlocks("<div>raw html</div>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe("<div>raw html</div>");
  });
});

describe("joinSelectedBlocks", () => {
  const blocks = [
    { id: "a", text: "first" },
    { id: "b", text: "second" },
    { id: "c", text: "third" },
  ];

  test("joins only the selected blocks, in message order", () => {
    expect(joinSelectedBlocks(blocks, new Set(["c", "a"]))).toBe("first\n\nthird");
  });

  test("selects everything by default", () => {
    expect(joinSelectedBlocks(blocks, selectAllBlockIds(blocks))).toBe("first\n\nsecond\n\nthird");
  });

  test("yields an empty string when nothing is selected", () => {
    expect(joinSelectedBlocks(blocks, new Set())).toBe("");
  });
});

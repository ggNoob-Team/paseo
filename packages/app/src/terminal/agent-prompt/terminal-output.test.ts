import { describe, expect, it } from "vitest";
import { concatByteChunks, sanitizeTerminalOutput, truncateTerminalText } from "./terminal-output";

describe("sanitizeTerminalOutput", () => {
  it("removes color, cursor and operating-system control sequences", () => {
    const raw = "\u001b]0;title\u0007\u001b[32muptime\u001b[0m\n\u001b[?25lresult\u001b[?25h";
    expect(sanitizeTerminalOutput(raw)).toBe("uptime\nresult");
  });

  it("keeps only the final carriage-return frame of a line", () => {
    expect(sanitizeTerminalOutput("progress 10%\rprogress 50%\rdone\r\nnext")).toBe("done\nnext");
  });

  it("drops stray control characters and trailing whitespace", () => {
    expect(sanitizeTerminalOutput("a\u0000b  \r\n\r\n\r\nc\t")).toBe("ab\n\nc");
  });

  it("returns an empty string for output that only contains control codes", () => {
    expect(sanitizeTerminalOutput("\u001b[0m\u001b[2K\r")).toBe("");
  });
});

describe("concatByteChunks", () => {
  it("joins chunks in order", () => {
    const merged = concatByteChunks([new Uint8Array([1, 2]), new Uint8Array([3])]);
    expect([...merged]).toEqual([1, 2, 3]);
  });

  it("returns an empty array for no chunks", () => {
    expect(concatByteChunks([]).length).toBe(0);
  });
});

describe("truncateTerminalText", () => {
  it("marks truncated output", () => {
    expect(truncateTerminalText("abcdef", 3)).toBe("abc\n...[truncated]");
  });

  it("keeps short output untouched", () => {
    expect(truncateTerminalText("abc", 3)).toBe("abc");
  });
});

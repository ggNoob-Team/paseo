import { describe, expect, test } from "vitest";
import { buildNotePreviewSegments, type NotePreviewSegment } from "./note-preview";

function plain(segments: NotePreviewSegment[]): Array<{ text: string; href: string | null }> {
  return segments.map(({ text, href }) => ({ text, href }));
}

describe("buildNotePreviewSegments", () => {
  test("drops inline markers and keeps the words", () => {
    expect(plain(buildNotePreviewSegments("Some **bold** and `code` text"))).toEqual([
      { text: "Some bold and code text", href: null },
    ]);
  });

  test("keeps named links and their target", () => {
    expect(plain(buildNotePreviewSegments("See [the docs](https://example.com/docs) now"))).toEqual(
      [
        { text: "See ", href: null },
        { text: "the docs", href: "https://example.com/docs" },
        { text: " now", href: null },
      ],
    );
  });

  test("linkifies a bare url", () => {
    expect(plain(buildNotePreviewSegments("go to https://example.com/x for more"))).toEqual([
      { text: "go to ", href: null },
      { text: "https://example.com/x", href: "https://example.com/x" },
      { text: " for more", href: null },
    ]);
  });

  test("ignores links that are not openable urls", () => {
    expect(plain(buildNotePreviewSegments("[relative](/some/path)"))).toEqual([
      { text: "relative", href: null },
    ]);
  });

  test("separates blocks and keeps code bodies", () => {
    const segments = buildNotePreviewSegments(
      ["First paragraph.", "", "```ts", "const a = 1;", "```", "", "- item one"].join("\n"),
    );
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "First paragraph.\nconst a = 1;\nitem one",
    );
  });

  test("merges adjacent runs that point at the same place", () => {
    expect(plain(buildNotePreviewSegments("plain text"))).toEqual([
      { text: "plain text", href: null },
    ]);
  });

  test("falls back to the raw text when there is nothing to parse", () => {
    expect(plain(buildNotePreviewSegments("   "))).toEqual([]);
  });
});

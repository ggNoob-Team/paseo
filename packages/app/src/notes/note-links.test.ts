import { describe, expect, test } from "vitest";
import { extractNoteLinks } from "./note-links";

describe("extractNoteLinks", () => {
  test("collects links in order and drops duplicates", () => {
    const links = extractNoteLinks(
      [
        "First [one](https://a.example/1) and https://b.example/2.",
        "",
        "Again [one](https://a.example/1) and [three](https://c.example/3).",
      ].join("\n"),
    );
    expect(links).toEqual(["https://a.example/1", "https://b.example/2", "https://c.example/3"]);
  });

  test("ignores text without links and links that cannot be opened", () => {
    expect(extractNoteLinks("plain text only")).toEqual([]);
    expect(extractNoteLinks("[relative](/somewhere) and mailto:a@b.com")).toEqual([]);
  });

  test("finds links inside lists but leaves code fences alone", () => {
    const links = extractNoteLinks(
      ["- item https://a.example/x", "", "```", "https://b.example/y", "```"].join("\n"),
    );
    // A url inside a code fence is code the user pasted, not a link they kept.
    expect(links).toEqual(["https://a.example/x"]);
  });
});

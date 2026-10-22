import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appSourceRoot = join(__dirname, "..");

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "i18n") return [];
      return collectSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/**
 * Expo Router vendors React Navigation, so the bare package's hooks read a
 * different context and throw "Couldn't find a navigation object". Importing
 * from `expo-router/react-navigation` is the only hook source that matches the
 * navigator Expo Router mounts.
 */
describe("navigation imports", () => {
  it("never imports from the bare @react-navigation/native package", () => {
    const offenders = collectSourceFiles(appSourceRoot).filter((path) =>
      /from\s+["']@react-navigation\/native["']/.test(readFileSync(path, "utf8")),
    );

    expect(offenders.map((path) => relative(appSourceRoot, path))).toEqual([]);
  });
});

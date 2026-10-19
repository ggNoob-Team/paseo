import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalFileChunk, statLocalFile } from "./local-files";

let testDir: string | null = null;

async function writeTempFile(bytes: Uint8Array): Promise<string> {
  testDir = await mkdtemp(path.join(os.tmpdir(), "paseo-local-files-"));
  const filePath = path.join(testDir, "data.bin");
  await writeFile(filePath, bytes);
  return filePath;
}

describe("desktop local files", () => {
  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
      testDir = null;
    }
  });

  it("stats a file and reads a bounded chunk at an offset", async () => {
    const filePath = await writeTempFile(new TextEncoder().encode("hello world"));

    await expect(statLocalFile({ path: filePath })).resolves.toEqual({ size: 11 });
    await expect(readLocalFileChunk({ path: filePath, offset: 6, length: 5 })).resolves.toEqual(
      new TextEncoder().encode("world"),
    );
  });

  it("rejects a chunk larger than the IPC bound", async () => {
    const filePath = await writeTempFile(new Uint8Array([1]));

    await expect(
      readLocalFileChunk({ path: filePath, offset: 0, length: 8 * 1024 * 1024 + 1 }),
    ).rejects.toThrow("File chunk length");
  });
});

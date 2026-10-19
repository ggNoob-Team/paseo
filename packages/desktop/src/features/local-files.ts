import { open, stat } from "node:fs/promises";

const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export interface LocalFileStat {
  size: number;
}

function resolveFilePath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("File path is required.");
  }
  return value.trim();
}

function resolveOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("File offset must be a non-negative integer.");
  }
  return value;
}

function resolveLength(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_CHUNK_BYTES
  ) {
    throw new Error(`File chunk length must be between 1 and ${MAX_CHUNK_BYTES} bytes.`);
  }
  return value;
}

export async function statLocalFile(input: { path?: unknown }): Promise<LocalFileStat> {
  const filePath = resolveFilePath(input.path);
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile()) {
    throw new Error("Requested path is not a file.");
  }
  return { size: fileInfo.size };
}

export async function readLocalFileChunk(input: {
  path?: unknown;
  offset?: unknown;
  length?: unknown;
}): Promise<Uint8Array> {
  const filePath = resolveFilePath(input.path);
  const offset = resolveOffset(input.offset);
  const length = resolveLength(input.length);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return Uint8Array.from(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

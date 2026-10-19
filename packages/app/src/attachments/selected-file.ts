import { getMimeTypeFromPath } from "@/attachments/file-types";
import { readDesktopFileChunk } from "@/desktop/local-files";

export interface SelectedFile {
  fileName: string;
  mimeType: string;
  /** Exact byte length declared to the daemon. */
  size: number;
  /** Reads a bounded window so large uploads never buffer the whole file. */
  readChunk(offset: number, length: number): Promise<Uint8Array>;
  /** Releases any source handle; safe to call when no handle was opened. */
  close(): Promise<void>;
}

const READ_ALL_CHUNK_BYTES = 1024 * 1024;

/** Materializes a small selected file, for callers that cannot stream. */
export async function readSelectedFileBytes(file: SelectedFile): Promise<Uint8Array> {
  const bytes = new Uint8Array(file.size);
  try {
    let offset = 0;
    while (offset < file.size) {
      const length = Math.min(READ_ALL_CHUNK_BYTES, file.size - offset);
      const chunk = await file.readChunk(offset, length);
      if (chunk.byteLength !== length) {
        throw new Error(`Could not read ${file.fileName}.`);
      }
      bytes.set(chunk, offset);
      offset += length;
    }
    return bytes;
  } finally {
    await file.close();
  }
}

export function fileNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) {
      return segment;
    }
  }
  return path;
}

export function selectedFileFromWebFile(file: File): SelectedFile {
  return {
    fileName: file.name,
    mimeType: file.type || getMimeTypeFromPath(file.name),
    size: file.size,
    readChunk: async (offset, length) =>
      new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
    close: async () => {},
  };
}

export function selectedFileFromDesktopPath(path: string, size: number): SelectedFile {
  return {
    fileName: fileNameFromPath(path),
    mimeType: getMimeTypeFromPath(path),
    size,
    readChunk: (offset, length) => readDesktopFileChunk({ path, offset, length }),
    close: async () => {},
  };
}

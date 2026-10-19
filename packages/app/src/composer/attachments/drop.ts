import {
  getMimeTypeFromPath,
  isRasterImageFile,
  isRasterImagePath,
} from "@/attachments/file-types";
import {
  fileNameFromPath,
  selectedFileFromWebFile,
  type SelectedFile,
} from "@/attachments/selected-file";
import { readDesktopFileChunk, statDesktopFile } from "@/desktop/local-files";
import type { DroppedItem } from "@/components/file-drop/types";

interface DroppedAttachmentsRuntime {
  statDesktopFile(path: string): Promise<{ size: number }>;
  readDesktopFileChunk(input: {
    path: string;
    offset: number;
    length: number;
  }): Promise<Uint8Array>;
}

const defaultRuntime: DroppedAttachmentsRuntime = {
  statDesktopFile,
  readDesktopFileChunk,
};

export async function droppedItemsToSelectedFiles(
  items: DroppedItem[],
  runtime: DroppedAttachmentsRuntime = defaultRuntime,
): Promise<SelectedFile[]> {
  const files: SelectedFile[] = [];

  for (const item of items) {
    if (item.kind === "web-file") {
      if (isRasterImageFile(item.file)) {
        continue;
      }
      files.push(selectedFileFromWebFile(item.file));
      continue;
    }

    if (isRasterImagePath(item.path)) {
      continue;
    }
    const path = item.path;
    const { size } = await runtime.statDesktopFile(path);
    files.push({
      fileName: fileNameFromPath(path),
      mimeType: getMimeTypeFromPath(path),
      size,
      readChunk: (offset, length) => runtime.readDesktopFileChunk({ path, offset, length }),
      close: async () => {},
    });
  }

  return files;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectedFile } from "@/attachments/selected-file";
import { useUploadStore, type FileUploadRunner, type NewFileUploadItem } from "./upload-store";

const scope = {
  serverId: "server-1",
  workspaceId: "workspace-1",
  workspaceRoot: "/workspace",
};

function makeFile(close = vi.fn(async () => {})): SelectedFile {
  return {
    fileName: "notes.txt",
    mimeType: "text/plain",
    size: 10,
    readChunk: async () => new Uint8Array(),
    close,
  };
}

function makeItem(
  file: SelectedFile,
  overrides: Partial<NewFileUploadItem> = {},
): NewFileUploadItem {
  return {
    id: "upload-1",
    serverId: scope.serverId,
    workspaceId: scope.workspaceId,
    workspaceRoot: scope.workspaceRoot,
    parentPath: ".",
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    overwrite: false,
    file,
    ...overrides,
  };
}

afterEach(() => {
  useUploadStore.setState({ uploads: new Map(), pending: [], activeId: null });
  vi.useRealTimers();
});

describe("upload store", () => {
  it("queues a file, reports progress, and completes it", async () => {
    const file = makeFile();
    const runner: FileUploadRunner = {
      getReceivedBytes: vi.fn(async () => 0),
      upload: vi.fn(async ({ onProgress }) => {
        onProgress(4);
        onProgress(10);
        return { ok: true as const };
      }),
    };

    useUploadStore.getState().enqueue({ items: [makeItem(file)], runner });

    await vi.waitFor(() => {
      expect(useUploadStore.getState().uploads.get("upload-1")?.status).toBe("completed");
    });
    expect(useUploadStore.getState().uploads.get("upload-1")?.uploadedBytes).toBe(10);
    expect(runner.upload).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, item: expect.objectContaining({ id: "upload-1" }) }),
    );
    expect(file.close).toHaveBeenCalled();
  });

  it("keeps a failed upload and resumes from the daemon's offset", async () => {
    const file = makeFile();
    const upload: FileUploadRunner["upload"] = vi
      .fn()
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress(4);
        return { ok: false as const, error: "network down" };
      })
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress(10);
        return { ok: true as const };
      });
    const runner: FileUploadRunner = {
      getReceivedBytes: vi.fn(async () => 4),
      upload,
    };

    useUploadStore.getState().enqueue({ items: [makeItem(file)], runner });

    await vi.waitFor(() => {
      expect(useUploadStore.getState().uploads.get("upload-1")?.status).toBe("failed");
    });
    expect(useUploadStore.getState().uploads.get("upload-1")).toMatchObject({
      uploadedBytes: 4,
      error: "network down",
    });

    useUploadStore.getState().resume("upload-1", runner);

    await vi.waitFor(() => {
      expect(useUploadStore.getState().uploads.get("upload-1")?.status).toBe("completed");
    });
    expect(runner.getReceivedBytes).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 4 }));
    expect(useUploadStore.getState().uploads.get("upload-1")?.uploadedBytes).toBe(10);
  });
});

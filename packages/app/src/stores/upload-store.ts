import { create } from "zustand";
import type { SelectedFile } from "@/attachments/selected-file";

export type FileUploadStatus = "queued" | "uploading" | "failed" | "completed";

export interface FileUploadItem {
  id: string;
  serverId: string;
  workspaceId: string | null;
  workspaceRoot: string;
  parentPath: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBytes: number;
  status: FileUploadStatus;
  error: string | null;
  overwrite: boolean;
  /** A resumed item asks the runner where the daemon stopped before streaming again. */
  resumeRequested: boolean;
  file: SelectedFile;
  createdAt: number;
}

export interface NewFileUploadItem {
  id: string;
  serverId: string;
  workspaceId: string | null;
  workspaceRoot: string;
  parentPath: string;
  fileName: string;
  mimeType: string;
  size: number;
  overwrite: boolean;
  file: SelectedFile;
}

export type FileUploadAttemptResult = { ok: true } | { ok: false; error: string };

export interface FileUploadRunner {
  /** Bytes already stored on the daemon for this upload id. */
  getReceivedBytes(item: FileUploadItem): Promise<number>;
  /** Streams from `offset` and reports the absolute bytes accepted by the daemon. */
  upload(input: {
    item: FileUploadItem;
    offset: number;
    onProgress: (uploadedBytes: number) => void;
  }): Promise<FileUploadAttemptResult>;
}

interface UploadState {
  uploads: Map<string, FileUploadItem>;
  pending: string[];
  activeId: string | null;
  enqueue(input: { items: NewFileUploadItem[]; runner: FileUploadRunner }): void;
  resume(id: string, runner: FileUploadRunner): void;
  setOverwrite(id: string, overwrite: boolean): void;
  updateProgress(id: string, uploadedBytes: number): void;
  remove(id: string): void;
}

export interface FileUploadScope {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}

const PROGRESS_UPDATE_INTERVAL_MS = 100;
const COMPLETED_AUTO_REMOVE_MS = 2500;

const runners = new Map<string, FileUploadRunner>();
const completedTimers = new Map<string, ReturnType<typeof setTimeout>>();
let processing = false;

export const useUploadStore = create<UploadState>()((set, get) => ({
  uploads: new Map(),
  pending: [],
  activeId: null,

  enqueue: ({ items, runner }) => {
    if (items.length === 0) {
      return;
    }
    set((state) => {
      const uploads = new Map(state.uploads);
      const pending = [...state.pending];
      const createdAt = Date.now();
      for (const input of items) {
        if (uploads.has(input.id)) {
          continue;
        }
        uploads.set(input.id, {
          ...input,
          uploadedBytes: 0,
          status: "queued",
          error: null,
          resumeRequested: false,
          createdAt,
        });
        pending.push(input.id);
        runners.set(input.id, runner);
      }
      return { uploads, pending };
    });
    void processQueue();
  },

  resume: (id, runner) => {
    const item = get().uploads.get(id);
    if (!item || item.status !== "failed") {
      return;
    }
    runners.set(id, runner);
    set((state) => {
      const uploads = new Map(state.uploads);
      uploads.set(id, { ...item, status: "queued", error: null, resumeRequested: true });
      const pending = state.pending.includes(id) ? state.pending : [...state.pending, id];
      return { uploads, pending };
    });
    void processQueue();
  },

  setOverwrite: (id, overwrite) => {
    set((state) => {
      const item = state.uploads.get(id);
      if (!item) {
        return state;
      }
      const uploads = new Map(state.uploads);
      uploads.set(id, { ...item, overwrite });
      return { uploads };
    });
  },

  updateProgress: (id, uploadedBytes) => {
    set((state) => {
      const item = state.uploads.get(id);
      if (!item) {
        return state;
      }
      const uploads = new Map(state.uploads);
      uploads.set(id, {
        ...item,
        uploadedBytes: Math.max(0, Math.min(uploadedBytes, item.size)),
      });
      return { uploads };
    });
  },

  remove: (id) => {
    const item = get().uploads.get(id);
    if (!item) {
      return;
    }
    const timer = completedTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      completedTimers.delete(id);
    }
    runners.delete(id);
    set((state) => {
      const uploads = new Map(state.uploads);
      uploads.delete(id);
      return {
        uploads,
        pending: state.pending.filter((pendingId) => pendingId !== id),
        activeId: state.activeId === id ? null : state.activeId,
      };
    });
    void item.file.close().catch(() => undefined);
  },
}));

export function isFileUploadInScope(
  item: Pick<FileUploadItem, "serverId" | "workspaceId" | "workspaceRoot">,
  scope: FileUploadScope,
): boolean {
  if (item.serverId !== scope.serverId) {
    return false;
  }
  const workspaceId = scope.workspaceId?.trim();
  return workspaceId
    ? item.workspaceId === workspaceId
    : item.workspaceRoot === scope.workspaceRoot;
}

export function hasActiveFileUploads(
  uploads: Map<string, FileUploadItem>,
  scope: FileUploadScope,
): boolean {
  for (const item of uploads.values()) {
    if (
      isFileUploadInScope(item, scope) &&
      (item.status === "queued" || item.status === "uploading")
    ) {
      return true;
    }
  }
  return false;
}

async function processQueue(): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;
  try {
    while (true) {
      const state = useUploadStore.getState();
      const id = state.pending[0];
      if (!id) {
        return;
      }
      useUploadStore.setState((current) => ({
        pending: current.pending.filter((pendingId) => pendingId !== id),
      }));
      const item = state.uploads.get(id);
      if (!item) {
        continue;
      }
      const runner = runners.get(id);
      if (!runner) {
        markFailed(id, "Upload runner is unavailable.");
        continue;
      }
      useUploadStore.setState((current) => {
        const currentItem = current.uploads.get(id);
        if (!currentItem) {
          return current;
        }
        const uploads = new Map(current.uploads);
        uploads.set(id, { ...currentItem, status: "uploading", error: null });
        return { uploads, activeId: id };
      });

      try {
        let offset = item.uploadedBytes;
        if (item.resumeRequested) {
          offset = await runner.getReceivedBytes(item);
          useUploadStore.getState().updateProgress(id, offset);
        }
        const onProgress = createProgressReporter(id, item.size, offset);
        const result = await runner.upload({ item, offset, onProgress });
        if (result.ok) {
          markCompleted(id);
        } else {
          markFailed(id, result.error);
        }
      } catch (error) {
        markFailed(id, error instanceof Error ? error.message : String(error));
      } finally {
        await item.file.close().catch(() => undefined);
        useUploadStore.setState({ activeId: null });
      }
    }
  } finally {
    processing = false;
    const state = useUploadStore.getState();
    if (!state.activeId && state.pending.length > 0) {
      void processQueue();
    }
  }
}

function createProgressReporter(
  id: string,
  size: number,
  initialOffset: number,
): (uploadedBytes: number) => void {
  let lastReportedBytes = initialOffset;
  let lastReportedAt = 0;
  const step = Math.max(1, Math.floor(size / 100));
  return (uploadedBytes) => {
    const now = Date.now();
    const isFinal = size === 0 || uploadedBytes >= size;
    if (
      !isFinal &&
      now - lastReportedAt < PROGRESS_UPDATE_INTERVAL_MS &&
      uploadedBytes - lastReportedBytes < step
    ) {
      return;
    }
    lastReportedAt = now;
    lastReportedBytes = uploadedBytes;
    useUploadStore.getState().updateProgress(id, uploadedBytes);
  };
}

function markFailed(id: string, error: string): void {
  useUploadStore.setState((state) => {
    const item = state.uploads.get(id);
    if (!item) {
      return state;
    }
    const uploads = new Map(state.uploads);
    uploads.set(id, { ...item, status: "failed", error });
    return { uploads };
  });
}

function markCompleted(id: string): void {
  useUploadStore.setState((state) => {
    const item = state.uploads.get(id);
    if (!item) {
      return state;
    }
    const uploads = new Map(state.uploads);
    uploads.set(id, { ...item, status: "completed", uploadedBytes: item.size, error: null });
    return { uploads };
  });
  const timer = setTimeout(() => {
    completedTimers.delete(id);
    useUploadStore.getState().remove(id);
  }, COMPLETED_AUTO_REMOVE_MS);
  completedTimers.set(id, timer);
}

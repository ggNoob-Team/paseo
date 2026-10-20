import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_FILE_UPLOAD_BYTES,
  MAX_FILE_UPLOAD_LABEL,
} from "@getpaseo/protocol/file-upload-limits";
import { useFilePicker } from "@/hooks/use-file-picker";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  hasActiveFileUploads,
  useUploadStore,
  type FileUploadAttemptResult,
  type FileUploadItem,
  type FileUploadRunner,
} from "@/stores/upload-store";
import type { SelectedFile } from "@/attachments/selected-file";

interface UseFileUploadParams {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  canResume: boolean;
}

interface FileUploadControls {
  isUploading: boolean;
  /** Picks local files, queues them, and returns how many were queued. */
  uploadFiles(parentPath: string): Promise<number>;
  resumeUpload(id: string): void;
  dismissUpload(id: string): void;
}

/**
 * Queues local files for upload into a workspace directory. The upload store
 * keeps the queue and progress alive while this panel is unmounted, so the
 * Files pane can show failures and resume them later.
 */
export function useFileUpload({
  serverId,
  workspaceId,
  workspaceRoot,
  canResume,
}: UseFileUploadParams): FileUploadControls {
  const { t } = useTranslation();
  const toast = useToast();
  const { pickFiles } = useFilePicker();
  const { uploadFileEntry, requestFileEntryUploadStatus, requestDirectoryListing } =
    useFileExplorerActions({
      serverId,
      workspaceId,
      workspaceRoot,
    });
  const scope = useMemo(
    () => ({ serverId, workspaceId: workspaceId ?? null, workspaceRoot }),
    [serverId, workspaceId, workspaceRoot],
  );
  const isUploading = useUploadStore((state) => hasActiveFileUploads(state.uploads, scope));

  const runner = useMemo<FileUploadRunner>(() => {
    async function readReceivedBytes(item: FileUploadItem): Promise<number> {
      const status = await requestFileEntryUploadStatus({
        parentPath: item.parentPath,
        fileName: item.fileName,
        uploadId: item.id,
      });
      if (status.error) {
        throw new Error(status.error);
      }
      return status.receivedBytes;
    }

    async function uploadItem(input: {
      item: FileUploadItem;
      offset: number;
      onProgress: (uploadedBytes: number) => void;
    }): Promise<FileUploadAttemptResult> {
      try {
        const payload = await uploadFileEntry({
          parentPath: input.item.parentPath,
          fileName: input.item.fileName,
          mimeType: input.item.mimeType,
          source: input.item.file,
          overwrite: input.item.overwrite,
          uploadId: input.item.id,
          offset: input.offset,
          onProgress: input.onProgress,
        });
        if (payload.success) {
          await requestDirectoryListing(input.item.parentPath, {
            recordHistory: false,
            setCurrentPath: false,
          });
          return { ok: true };
        }
        if (payload.alreadyExists && !input.item.overwrite) {
          const replace = await confirmDialog({
            title: t("workspace.fileActions.confirmOverwrite.title"),
            message: t("workspace.fileActions.confirmOverwrite.message", {
              name: input.item.fileName,
            }),
            confirmLabel: t("workspace.fileActions.confirmOverwrite.confirm"),
            cancelLabel: t("workspace.fileActions.confirmOverwrite.cancel"),
            destructive: true,
          });
          if (!replace) {
            return {
              ok: false,
              error:
                payload.error ??
                t("workspace.fileExplorer.upload.failed", {
                  name: input.item.fileName,
                }),
            };
          }
          useUploadStore.getState().setOverwrite(input.item.id, true);
          // The conflict may arrive before any chunk is stored, or after the
          // whole file sits in the temp file. Ask the daemon where it stopped.
          const resumeOffset = canResume ? await readReceivedBytes(input.item) : input.offset;
          return await uploadItem({
            ...input,
            item: { ...input.item, overwrite: true },
            offset: resumeOffset,
          });
        }
        return {
          ok: false,
          error:
            payload.error ??
            t("workspace.fileExplorer.upload.failed", { name: input.item.fileName }),
        };
      } catch (cause) {
        return {
          ok: false,
          error:
            cause instanceof Error
              ? cause.message
              : t("workspace.fileExplorer.errors.uploadFailed"),
        };
      }
    }

    return {
      getReceivedBytes: readReceivedBytes,
      upload: uploadItem,
    };
  }, [canResume, requestDirectoryListing, requestFileEntryUploadStatus, t, uploadFileEntry]);

  const uploadFiles = useCallback(
    async (parentPath: string): Promise<number> => {
      const files = await pickFiles();
      if (!files || files.length === 0) {
        return 0;
      }
      const oversized = files.find((file) => file.size > MAX_FILE_UPLOAD_BYTES);
      if (oversized) {
        await Promise.all(files.map((file) => file.close()));
        toast.error(
          t("workspace.fileExplorer.upload.tooLarge", {
            fileName: oversized.fileName,
            size: MAX_FILE_UPLOAD_LABEL,
          }),
        );
        return 0;
      }
      try {
        for (const file of files) {
          if (file.size === 0) {
            continue;
          }
          const probe = await file.readChunk(0, 1);
          if (probe.byteLength === 0) {
            throw new Error(t("workspace.fileExplorer.upload.failed", { name: file.fileName }));
          }
          await file.close();
        }
      } catch (cause) {
        await Promise.all(files.map((file) => file.close()));
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.uploadFailed"),
        );
        return 0;
      }

      const items = files.map((file: SelectedFile) => ({
        id: crypto.randomUUID(),
        serverId,
        workspaceId: workspaceId ?? null,
        workspaceRoot,
        parentPath,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        overwrite: false,
        file,
      }));
      useUploadStore.getState().enqueue({ items, runner });
      return items.length;
    },
    [pickFiles, runner, serverId, t, toast, workspaceId, workspaceRoot],
  );

  const resumeUpload = useCallback(
    (id: string) => {
      useUploadStore.getState().resume(id, runner);
    },
    [runner],
  );

  const dismissUpload = useCallback((id: string) => {
    useUploadStore.getState().remove(id);
  }, []);

  return { isUploading, uploadFiles, resumeUpload, dismissUpload };
}

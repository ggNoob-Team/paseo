import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilePicker } from "@/hooks/use-file-picker";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { SelectedFile } from "@/attachments/selected-file";

interface UseFileUploadParams {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}

interface FileUploadControls {
  isUploading: boolean;
  /** Picks local files and uploads them into `parentPath`; returns how many landed. */
  uploadFiles(parentPath: string): Promise<number>;
}

/**
 * Uploads local files into a workspace directory through the file explorer.
 * Shared by the toolbar button and directory context menus so both paths pick,
 * confirm replacements, and report progress identically.
 */
export function useFileUpload({
  serverId,
  workspaceId,
  workspaceRoot,
}: UseFileUploadParams): FileUploadControls {
  const { t } = useTranslation();
  const toast = useToast();
  const { pickFiles } = useFilePicker();
  const { uploadFileEntry } = useFileExplorerActions({ serverId, workspaceId, workspaceRoot });
  const [isUploading, setIsUploading] = useState(false);
  const isUploadingRef = useRef(false);

  const uploadOne = useCallback(
    async (
      parentPath: string,
      file: SelectedFile,
      bytes: Uint8Array,
      overwrite: boolean,
    ): Promise<boolean> => {
      const payload = await uploadFileEntry({
        parentPath,
        fileName: file.fileName,
        mimeType: file.mimeType,
        bytes,
        overwrite,
      });
      if (payload.success) {
        return true;
      }
      if (payload.alreadyExists && !overwrite) {
        const replace = await confirmDialog({
          title: t("workspace.fileActions.confirmOverwrite.title"),
          message: t("workspace.fileActions.confirmOverwrite.message", { name: file.fileName }),
          confirmLabel: t("workspace.fileActions.confirmOverwrite.confirm"),
          cancelLabel: t("workspace.fileActions.confirmOverwrite.cancel"),
          destructive: true,
        });
        if (!replace) {
          return false;
        }
        return await uploadOne(parentPath, file, bytes, true);
      }
      throw new Error(
        payload.error ?? t("workspace.fileExplorer.upload.failed", { name: file.fileName }),
      );
    },
    [t, uploadFileEntry],
  );

  const uploadFiles = useCallback(
    async (parentPath: string): Promise<number> => {
      if (isUploadingRef.current) {
        return 0;
      }
      const files = await pickFiles();
      if (!files || files.length === 0) {
        return 0;
      }
      isUploadingRef.current = true;
      setIsUploading(true);
      let uploaded = 0;
      let uploadedName: string | null = null;
      let reportedFailure = false;
      try {
        for (const file of files) {
          const bytes = await file.readBytes();
          const landed = await uploadOne(parentPath, file, bytes, false);
          if (landed) {
            uploaded += 1;
            uploadedName ??= file.fileName;
          }
        }
      } catch (cause) {
        reportedFailure = true;
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.uploadFailed"),
        );
      } finally {
        isUploadingRef.current = false;
        setIsUploading(false);
      }
      if (uploaded > 0 && !reportedFailure) {
        toast.show(
          t("workspace.fileExplorer.upload.uploaded", { count: uploaded, name: uploadedName }),
          { variant: "success" },
        );
      }
      return uploaded;
    },
    [pickFiles, t, toast, uploadOne],
  );

  return { isUploading, uploadFiles };
}

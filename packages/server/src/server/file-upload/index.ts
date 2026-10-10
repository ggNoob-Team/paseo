import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { FileTransferOpcode, type FileTransferFrame } from "@getpaseo/protocol/binary-frames/index";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type { FileEntryUploadRequest, FileUploadRequest } from "../messages.js";

interface FileUploadStoreOptions {
  paseoHome: string;
  staleUploadTimeoutMs?: number;
}

/** Terminal result of one upload, translated into an RPC response by the session. */
export type FileUploadOutcome =
  | { status: "completed"; uploadId: string; fileName: string; path: string }
  | { status: "failed"; error: string; alreadyExists: boolean }
  | { status: "cancelled" };

type UploadFinished = (outcome: FileUploadOutcome) => void;

/** Where one upload streams its bytes and what removes partial artifacts. */
type UploadTarget =
  | {
      kind: "attachment";
      mimeType: string;
      stagingDirectory: string;
      streamPath: string;
      started: boolean;
    }
  | {
      kind: "workspace";
      cwd: string;
      parentPath: string;
      replace: boolean;
      /** Resolves the workspace directory on file begin, when the symlink scope can be checked. */
      resolveDirectory: () => Promise<string>;
      /** Set on file begin, before any chunk is accepted. */
      destination: UploadDestination | null;
    };

interface UploadDestination {
  /** Absolute path bytes stream into; a hidden temp file for replace uploads. */
  streamPath: string;
  /** Absolute path the finished file lands at. */
  destinationPath: string;
}

interface PendingUpload {
  requestId: string;
  id: string;
  source: object;
  fileName: string;
  size: number;
  receivedBytes: number;
  completed: boolean;
  finished: UploadFinished;
  target: UploadTarget;
  staleTimeout: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
  cleanup?: Promise<void>;
}

export class FileUploadStore {
  private static readonly defaultStaleUploadTimeoutMs = 10 * 60 * 1000;

  private readonly paseoHome: string;
  private readonly staleUploadTimeoutMs: number;
  private readonly defaultSource = {};
  private readonly pending = new Map<object, Map<string, PendingUpload>>();

  constructor(options: FileUploadStoreOptions) {
    this.paseoHome = options.paseoHome;
    this.staleUploadTimeoutMs =
      options.staleUploadTimeoutMs ?? FileUploadStore.defaultStaleUploadTimeoutMs;
  }

  beginUpload(
    request: FileUploadRequest,
    source: object = this.defaultSource,
    finished: UploadFinished = () => {},
  ): () => Promise<void> {
    const id = `upload_${randomUUID()}`;
    const fileName = sanitizeFileName(request.fileName);
    const stagingDirectory = join(this.paseoHome, "uploads", id);
    return this.register({
      requestId: request.requestId,
      id,
      source,
      fileName,
      size: request.size,
      finished,
      target: {
        kind: "attachment",
        mimeType: request.mimeType,
        stagingDirectory,
        streamPath: join(stagingDirectory, fileName),
        started: false,
      },
    });
  }

  /**
   * Receives an explorer upload into a workspace directory. Registration is
   * synchronous so transfer frames that follow the request are never dropped;
   * the directory itself resolves on file begin.
   */
  beginFileEntryUpload(
    request: FileEntryUploadRequest,
    options: {
      resolveDirectory: () => Promise<string>;
      source: object;
      finished: UploadFinished;
    },
  ): () => Promise<void> {
    return this.register({
      requestId: request.requestId,
      id: `upload_${randomUUID()}`,
      source: options.source,
      fileName: sanitizeFileName(request.fileName),
      size: request.size,
      finished: options.finished,
      target: {
        kind: "workspace",
        cwd: request.cwd,
        parentPath: request.parentPath,
        replace: request.overwrite === true,
        resolveDirectory: options.resolveDirectory,
        destination: null,
      },
    });
  }

  async receiveFrame(
    frame: FileTransferFrame,
    source: object = this.defaultSource,
  ): Promise<FileUploadOutcome | null> {
    const upload = this.pending.get(source)?.get(frame.requestId);
    if (!upload) {
      return null;
    }
    this.refreshStaleUploadTimeout(upload);

    const operation = upload.queue.then(() => this.applyFrame(upload, frame));
    void operation.then(
      (outcome) => {
        if (outcome) upload.finished(outcome);
        return undefined;
      },
      (error: unknown) => {
        upload.finished({ status: "failed", error: getErrorMessage(error), alreadyExists: false });
      },
    );
    upload.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private register(input: {
    requestId: string;
    id: string;
    source: object;
    fileName: string;
    size: number;
    finished: UploadFinished;
    target: UploadTarget;
  }): () => Promise<void> {
    const existingUpload = this.pending.get(input.source)?.get(input.requestId);
    if (existingUpload) void this.cancel(existingUpload).catch(() => {});
    const upload: PendingUpload = {
      ...input,
      receivedBytes: 0,
      completed: false,
      staleTimeout: this.createStaleUploadTimeout(input.source, input.requestId),
      queue: Promise.resolve(),
    };
    const uploads = this.pending.get(input.source) ?? new Map<string, PendingUpload>();
    uploads.set(input.requestId, upload);
    this.pending.set(input.source, uploads);
    return () => this.cancel(upload);
  }

  private async applyFrame(
    upload: PendingUpload,
    frame: FileTransferFrame,
  ): Promise<FileUploadOutcome | null> {
    if (this.pending.get(upload.source)?.get(upload.requestId) !== upload) {
      return null;
    }

    try {
      if (frame.opcode === FileTransferOpcode.FileBegin) {
        await this.startWriting(upload);
        return null;
      }
      if (frame.opcode === FileTransferOpcode.FileChunk) {
        await this.writeChunk(upload, frame.payload);
        return null;
      }
      return await this.completeUpload(upload);
    } catch (error) {
      await this.removeFailedUpload(upload);
      return buildFailure(error);
    }
  }

  private async startWriting(upload: PendingUpload): Promise<void> {
    const { target } = upload;
    if (target.kind === "attachment") {
      await mkdir(target.stagingDirectory, { recursive: true });
      await writeFile(target.streamPath, new Uint8Array());
      target.started = true;
      return;
    }

    const directory = await target.resolveDirectory();
    const destinationPath = join(directory, upload.fileName);
    const streamPath = target.replace
      ? join(directory, `.${upload.fileName}.paseo-${randomUUID()}.tmp`)
      : destinationPath;
    let handle: FileHandle;
    try {
      handle = await open(streamPath, "wx", 0o644);
    } catch (error) {
      if (isFileExistsError(error)) throw new UploadDestinationExistsError(upload.fileName);
      throw error;
    }
    target.destination = { streamPath, destinationPath };
    await handle.close();
  }

  private async writeChunk(upload: PendingUpload, bytes: Uint8Array): Promise<void> {
    const streamPath = uploadStreamPath(upload);
    const nextReceivedBytes = upload.receivedBytes + bytes.byteLength;
    if (nextReceivedBytes > upload.size) {
      throw new Error(
        `Upload exceeded declared size: expected ${upload.size}, received ${nextReceivedBytes}.`,
      );
    }
    await appendFile(streamPath, bytes);
    upload.receivedBytes += bytes.byteLength;
  }

  private async completeUpload(upload: PendingUpload): Promise<FileUploadOutcome> {
    this.clearPendingUpload(upload);
    if (upload.receivedBytes !== upload.size) {
      await this.removePartialUpload(upload);
      return buildFailure(
        new Error(
          `Upload size mismatch: expected ${upload.size}, received ${upload.receivedBytes}.`,
        ),
      );
    }

    const { target } = upload;
    if (target.kind === "attachment") {
      upload.completed = true;
      return {
        status: "completed",
        uploadId: upload.id,
        fileName: upload.fileName,
        path: target.streamPath,
      };
    }

    const destination = target.destination;
    if (!destination) {
      return buildFailure(new Error("Upload ended before file begin."));
    }
    if (target.replace) {
      await rename(destination.streamPath, destination.destinationPath);
    }
    upload.completed = true;
    return {
      status: "completed",
      uploadId: upload.id,
      fileName: upload.fileName,
      path: destination.destinationPath,
    };
  }

  private createStaleUploadTimeout(
    source: object,
    requestId: string,
  ): ReturnType<typeof setTimeout> {
    const timeout = setTimeout(() => {
      const upload = this.pending.get(source)?.get(requestId);
      if (upload) void this.cancel(upload).catch(() => {});
    }, this.staleUploadTimeoutMs);
    timeout.unref?.();
    return timeout;
  }

  private refreshStaleUploadTimeout(upload: PendingUpload): void {
    clearTimeout(upload.staleTimeout);
    upload.staleTimeout = this.createStaleUploadTimeout(upload.source, upload.requestId);
  }

  private cancel(upload: PendingUpload): Promise<void> {
    if (upload.cleanup) return upload.cleanup;
    this.clearPendingUpload(upload);
    upload.cleanup = upload.queue.then(async () => {
      if (!upload.completed) await this.removePartialUpload(upload);
      return undefined;
    });
    upload.finished({ status: "cancelled" });
    return upload.cleanup;
  }

  private clearPendingUpload(upload: PendingUpload): void {
    clearTimeout(upload.staleTimeout);
    const uploads = this.pending.get(upload.source);
    if (uploads?.get(upload.requestId) === upload) uploads.delete(upload.requestId);
    if (uploads?.size === 0) this.pending.delete(upload.source);
  }

  private async removeFailedUpload(upload: PendingUpload): Promise<void> {
    this.clearPendingUpload(upload);
    await this.removePartialUpload(upload);
  }

  private async removePartialUpload(upload: PendingUpload): Promise<void> {
    const { target } = upload;
    if (target.kind === "attachment") {
      await rm(target.stagingDirectory, { recursive: true, force: true });
      return;
    }
    if (target.destination) {
      await rm(target.destination.streamPath, { force: true });
    }
  }
}

function uploadStreamPath(upload: PendingUpload): string {
  const { target } = upload;
  if (target.kind === "attachment") {
    if (!target.started) throw new Error("Upload chunks arrived before file begin.");
    return target.streamPath;
  }
  if (!target.destination) throw new Error("Upload chunks arrived before file begin.");
  return target.destination.streamPath;
}

function buildFailure(error: unknown): FileUploadOutcome {
  return {
    status: "failed",
    error: getErrorMessage(error),
    alreadyExists: error instanceof UploadDestinationExistsError,
  };
}

function isFileExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "EEXIST";
}

class UploadDestinationExistsError extends Error {
  constructor(fileName: string) {
    super(`"${fileName}" already exists`);
  }
}

// Most file systems cap a single file name at 255 bytes.
const MAX_FILE_NAME_BYTES = 255;

// Keeps the client's file name, replacing only what cannot appear in a single
// file name on Linux, macOS, or Windows.
function sanitizeFileName(value: string): string {
  const name = basename(value)
    .replace(/[\p{Cc}\\/:*?"<>|]/gu, "_")
    .trim();
  return fitFileNameLength(name.length > 0 && name !== "." && name !== ".." ? name : "upload");
}

function fitFileNameLength(name: string): string {
  if (Buffer.byteLength(name) <= MAX_FILE_NAME_BYTES) return name;
  const extension = extname(name);
  const keptExtension = Buffer.byteLength(extension) < MAX_FILE_NAME_BYTES ? extension : "";
  let stem = "";
  for (const char of name.slice(0, name.length - keptExtension.length)) {
    if (Buffer.byteLength(stem + char + keptExtension) > MAX_FILE_NAME_BYTES) break;
    stem += char;
  }
  return stem + keptExtension;
}

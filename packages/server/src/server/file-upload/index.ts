import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  copyFile,
  link,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
      uploadId: string;
      offset: number;
      replace: boolean;
      /** Resolves the workspace directory on file begin, when the symlink scope can be checked. */
      resolveDirectory: () => Promise<string>;
      /** Set on file begin, before any chunk is accepted. */
      destination: UploadDestination | null;
    };

interface UploadDestination {
  /** Absolute path bytes stream into; a hidden temp file for workspace uploads. */
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

const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STALE_UPLOAD_TEMP_MS = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_TEMP_PATTERN = /^\..+\.paseo-[A-Za-z0-9_-]+\.tmp$/;

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
      initialReceivedBytes: 0,
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
    const uploadId = request.uploadId ?? `upload_${randomUUID()}`;
    const offset = request.offset ?? 0;
    return this.register({
      requestId: request.requestId,
      id: uploadId,
      source: options.source,
      fileName: sanitizeFileName(request.fileName),
      size: request.size,
      initialReceivedBytes: offset,
      finished: options.finished,
      target: {
        kind: "workspace",
        cwd: request.cwd,
        parentPath: request.parentPath,
        uploadId,
        offset,
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
    initialReceivedBytes: number;
    finished: UploadFinished;
    target: UploadTarget;
  }): () => Promise<void> {
    const existingUpload = this.pending.get(input.source)?.get(input.requestId);
    if (existingUpload) void this.cancel(existingUpload).catch(() => {});
    const upload: PendingUpload = {
      requestId: input.requestId,
      id: input.id,
      source: input.source,
      fileName: input.fileName,
      size: input.size,
      receivedBytes: input.initialReceivedBytes,
      completed: false,
      finished: input.finished,
      target: input.target,
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
      await this.removeFailedUpload(upload, error);
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

    if (target.offset > upload.size) {
      throw new UploadOffsetMismatchError(
        `Upload offset ${target.offset} exceeds declared size ${upload.size}.`,
      );
    }

    const directory = await target.resolveDirectory();
    const destinationPath = join(directory, upload.fileName);
    const streamPath = fileEntryUploadTempPath({
      directory,
      fileName: upload.fileName,
      uploadId: target.uploadId,
    });

    if (target.offset === 0) {
      if (!target.replace) {
        await assertDestinationAvailable({ destinationPath, fileName: upload.fileName });
      }
      void cleanupStaleUploadTemps(directory);
      await writeFile(streamPath, new Uint8Array());
    } else {
      let existingSize: number | null = null;
      try {
        const fileInfo = await stat(streamPath);
        existingSize = fileInfo.isFile() ? fileInfo.size : null;
      } catch (error) {
        if (!isMissingEntryError(error)) {
          throw error;
        }
      }
      if (existingSize !== target.offset) {
        throw new UploadOffsetMismatchError(
          "Upload session is out of date. Refresh the upload status and try again.",
        );
      }
    }

    target.destination = { streamPath, destinationPath };
  }

  private async writeChunk(upload: PendingUpload, bytes: Uint8Array): Promise<void> {
    const streamPath = uploadStreamPath(upload);
    const nextReceivedBytes = upload.receivedBytes + bytes.byteLength;
    if (nextReceivedBytes > upload.size) {
      throw new UploadOverflowError(
        `Upload exceeded declared size: expected ${upload.size}, received ${nextReceivedBytes}.`,
      );
    }
    await appendFile(streamPath, bytes);
    upload.receivedBytes += bytes.byteLength;
  }

  private async completeUpload(upload: PendingUpload): Promise<FileUploadOutcome> {
    this.clearPendingUpload(upload);
    if (upload.receivedBytes !== upload.size) {
      await this.discardUploadArtifacts(upload);
      return buildFailure(
        new UploadSizeMismatchError(
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
    } else {
      await finalizeCreatedFile({
        streamPath: destination.streamPath,
        destinationPath: destination.destinationPath,
        fileName: upload.fileName,
      });
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
      if (!upload.completed) await this.abandonUpload(upload);
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

  private async removeFailedUpload(upload: PendingUpload, error: unknown): Promise<void> {
    this.clearPendingUpload(upload);
    await this.abandonUpload(upload, error);
  }

  private async abandonUpload(upload: PendingUpload, error?: unknown): Promise<void> {
    const { target } = upload;
    if (target.kind === "attachment") {
      await rm(target.stagingDirectory, { recursive: true, force: true });
      return;
    }
    if (error && shouldDiscardPartial(error)) {
      await this.discardUploadArtifacts(upload);
    }
  }

  private async discardUploadArtifacts(upload: PendingUpload): Promise<void> {
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

/** Deterministic hidden path that keeps a workspace upload resumable. */
export function fileEntryUploadTempPath(input: {
  directory: string;
  fileName: string;
  uploadId: string;
}): string {
  if (!UPLOAD_ID_PATTERN.test(input.uploadId)) {
    throw new Error("Invalid upload id.");
  }
  return join(input.directory, `.${sanitizeFileName(input.fileName)}.paseo-${input.uploadId}.tmp`);
}

async function assertDestinationAvailable(input: {
  destinationPath: string;
  fileName: string;
}): Promise<void> {
  try {
    await stat(input.destinationPath);
  } catch (error) {
    if (isMissingEntryError(error)) {
      return;
    }
    throw error;
  }
  throw new UploadDestinationExistsError(input.fileName);
}

async function finalizeCreatedFile(input: {
  streamPath: string;
  destinationPath: string;
  fileName: string;
}): Promise<void> {
  try {
    await link(input.streamPath, input.destinationPath);
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new UploadDestinationExistsError(input.fileName);
    }
    if (!isLinkUnsupportedError(error)) {
      throw error;
    }
    try {
      await copyFile(input.streamPath, input.destinationPath, constants.COPYFILE_EXCL);
    } catch (copyError) {
      if (isFileExistsError(copyError)) {
        throw new UploadDestinationExistsError(input.fileName);
      }
      throw copyError;
    }
  }
  await rm(input.streamPath, { force: true }).catch(() => undefined);
}

/** Best-effort cleanup for partials left behind by abandoned resumable uploads. */
async function cleanupStaleUploadTemps(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && UPLOAD_TEMP_PATTERN.test(entry.name))
        .map(async (entry) => {
          const tempPath = join(directory, entry.name);
          try {
            const fileInfo = await stat(tempPath);
            if (now - fileInfo.mtimeMs > STALE_UPLOAD_TEMP_MS) {
              await rm(tempPath, { force: true });
            }
          } catch {
            // A concurrent upload owns the file; leave it alone.
          }
        }),
    );
  } catch {
    // Cleanup is best effort and must never block a new upload.
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

function shouldDiscardPartial(error: unknown): boolean {
  return error instanceof UploadOverflowError || error instanceof UploadSizeMismatchError;
}

function isFileExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "EEXIST";
}

function isMissingEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isLinkUnsupportedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return (
    code === "EPERM" ||
    code === "EACCES" ||
    code === "ENOSYS" ||
    code === "ENOTSUP" ||
    code === "EOPNOTSUPP" ||
    code === "EXDEV" ||
    code === "EMLINK"
  );
}

class UploadDestinationExistsError extends Error {
  constructor(fileName: string) {
    super(`"${fileName}" already exists`);
  }
}

class UploadOverflowError extends Error {}

class UploadSizeMismatchError extends Error {}

class UploadOffsetMismatchError extends Error {}

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

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import { useUploadStore, type FileUploadItem } from "@/stores/upload-store";
import { FileUploadProgressList } from "./file-upload-progress-list";

void testI18n;

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

beforeEach(() => vi.stubGlobal("React", React));

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  useUploadStore.setState({ uploads: new Map(), pending: [], activeId: null });
});

function makeUpload(overrides: Partial<FileUploadItem>): FileUploadItem {
  return {
    id: "upload-1",
    serverId: "server-1",
    workspaceId: "workspace-1",
    workspaceRoot: "/workspace",
    parentPath: ".",
    fileName: "uploading.txt",
    mimeType: "text/plain",
    size: 10,
    uploadedBytes: 5,
    status: "uploading",
    error: null,
    overwrite: false,
    resumeRequested: false,
    createdAt: 1,
    file: {
      fileName: "uploading.txt",
      mimeType: "text/plain",
      size: 10,
      readChunk: async () => new Uint8Array(),
      close: async () => {},
    },
    ...overrides,
  };
}

function mountList(canResume: boolean) {
  const onResume = vi.fn();
  const onDismiss = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <FileUploadProgressList
        serverId="server-1"
        workspaceId="workspace-1"
        workspaceRoot="/workspace"
        canResume={canResume}
        onResume={onResume}
        onDismiss={onDismiss}
      />,
    ),
  );
  mounted.push({ root, container });
  return { view: within(container), onResume, onDismiss };
}

describe("FileUploadProgressList", () => {
  it("shows progress and resumes a failed upload", () => {
    useUploadStore.setState({
      uploads: new Map([
        ["upload-1", makeUpload({})],
        [
          "upload-2",
          makeUpload({
            id: "upload-2",
            fileName: "failed.txt",
            uploadedBytes: 3,
            status: "failed",
            error: "network down",
            createdAt: 2,
          }),
        ],
      ]),
      pending: [],
      activeId: "upload-1",
    });

    const { view, onResume, onDismiss } = mountList(true);

    expect(view.getByText("uploading.txt")).toBeTruthy();
    expect(view.getByText("failed.txt")).toBeTruthy();
    expect(view.getByText("network down")).toBeTruthy();
    expect(view.getAllByRole("progressbar")).toHaveLength(2);
    expect(view.getAllByRole("progressbar")[0]?.getAttribute("aria-valuenow")).toBe("50");

    act(() => view.getByTestId("file-upload-resume-upload-2").click());
    expect(onResume).toHaveBeenCalledWith("upload-2");
    act(() => view.getByTestId("file-upload-dismiss-upload-2").click());
    expect(onDismiss).toHaveBeenCalledWith("upload-2");
  });

  it("asks for a host update when resume is unsupported", () => {
    useUploadStore.setState({
      uploads: new Map([
        [
          "upload-2",
          makeUpload({
            id: "upload-2",
            fileName: "failed.txt",
            status: "failed",
            error: "network down",
          }),
        ],
      ]),
      pending: [],
      activeId: null,
    });

    const { view } = mountList(false);

    expect(view.getByText("Update host to resume")).toBeTruthy();
    expect(view.queryByTestId("file-upload-resume-upload-2")).toBeNull();
  });
});

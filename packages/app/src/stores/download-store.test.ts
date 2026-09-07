import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";

const { writeMock } = vi.hoisted(() => ({ writeMock: vi.fn() }));

vi.mock("expo-file-system", () => {
  class MockFile {
    readonly uri: string;
    exists = false;
    write = writeMock;

    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }
  }

  return {
    File: MockFile,
    Paths: { cache: "/cache", document: "/documents" },
  };
});

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => false),
  shareAsync: vi.fn(),
}));

import { useDownloadStore } from "./download-store";

function relayOnlyProfile(): HostProfile {
  return {
    serverId: "srv-test",
    label: "Relay host",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [
      {
        id: "relay:1",
        type: "relay",
        relayEndpoint: "wss://relay.paseo.sh",
        daemonPublicKeyB64: "test-key",
      },
    ],
    preferredConnectionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

type DownloadStore = ReturnType<typeof useDownloadStore.getState>;
type StartDownloadInput = Parameters<DownloadStore["startDownload"]>[0];

function startDownload(overrides: Partial<StartDownloadInput> = {}) {
  return useDownloadStore.getState().startDownload({
    serverId: "srv-test",
    scopeId: "/workspace",
    fileName: "notes.txt",
    path: "notes.txt",
    daemonProfile: relayOnlyProfile(),
    requestFileDownloadToken: vi.fn(),
    ...overrides,
  });
}

describe("download-store WebSocket fallback", () => {
  afterEach(() => {
    useDownloadStore.setState({ downloads: new Map(), activeDownloadId: null });
    writeMock.mockReset();
  });

  test("downloads through readFileBytes when the host has no HTTP download endpoint", async () => {
    const requestFileDownloadToken = vi.fn();
    const readFileBytes = vi.fn(async () => ({
      bytes: new TextEncoder().encode("hello"),
      mime: "text/plain",
    }));

    await startDownload({ requestFileDownloadToken, readFileBytes });

    expect(requestFileDownloadToken).not.toHaveBeenCalled();
    expect(readFileBytes).toHaveBeenCalledWith("notes.txt");

    const download = [...useDownloadStore.getState().downloads.values()][0];
    expect(download?.status).toBe("complete");
    expect(download?.message).toBeUndefined();
  });

  test("fails with the localized host-unavailable message when no fallback reader exists", async () => {
    await startDownload({ readFileBytes: undefined });

    const download = [...useDownloadStore.getState().downloads.values()][0];
    expect(download?.status).toBe("error");
    expect(download?.message).toContain("host");
  });
});

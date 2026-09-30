import { describe, expect, it } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const note = {
  projectId: "prj_1234",
  projectName: "Alpha",
  body: "# Alpha",
  bodyUpdatedAt: "2026-05-01T00:00:00.000Z",
  entries: [
    {
      entryId: "note_entry_1",
      createdAt: "2026-05-01T00:00:00.000Z",
      text: "captured text",
      comment: null,
      source: { workspaceId: "ws_1", agentId: "agent_1" },
      organizedAt: null,
    },
  ],
  lastError: null,
  updatedAt: "2026-05-01T00:00:00.000Z",
};

describe("project note protocol", () => {
  it("parses every notes request", () => {
    for (const message of [
      { type: "notes.project.list.request", requestId: "r1" },
      { type: "notes.project.get.request", requestId: "r2", projectId: "prj_1234" },
      {
        type: "notes.entry.append.request",
        requestId: "r3",
        projectId: "prj_1234",
        text: "captured text",
      },
      {
        type: "notes.project.update.request",
        requestId: "r4",
        projectId: "prj_1234",
        body: "hand written",
      },
      {
        type: "notes.entry.delete.request",
        requestId: "r5",
        projectId: "prj_1234",
        entryId: "note_entry_1",
      },
    ]) {
      expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  it("parses list, get, append, update, delete and the background push", () => {
    const messages = [
      {
        type: "notes.project.list.response",
        payload: {
          requestId: "r1",
          projects: [
            {
              projectId: "prj_1234",
              projectName: "Alpha",
              entryCount: 1,
              pendingEntryCount: 1,
              hasBody: true,
              lastError: null,
              updatedAt: "2026-05-01T00:00:00.000Z",
            },
          ],
        },
      },
      { type: "notes.project.get.response", payload: { requestId: "r2", note } },
      { type: "notes.entry.append.response", payload: { requestId: "r3", note } },
      { type: "notes.project.update.response", payload: { requestId: "r4", note } },
      { type: "notes.entry.delete.response", payload: { requestId: "r5", note } },
      { type: "notes.project.updated", payload: { note } },
    ];
    for (const message of messages) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  it("answers a get for a project with no note", () => {
    const message = {
      type: "notes.project.get.response",
      payload: { requestId: "r2", note: null },
    };
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });

  it("keeps the capability optional so older daemons still parse", () => {
    const base = { status: "server_info", serverId: "srv_1" } as const;
    expect(ServerInfoStatusPayloadSchema.parse(base).features?.notes).toBeUndefined();
    expect(
      ServerInfoStatusPayloadSchema.parse({
        ...base,
        features: { notes: true },
      }).features?.notes,
    ).toBe(true);
  });
});

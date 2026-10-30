import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import { isQuickInputCandidate } from "./candidates";
import { quickInputSessionKey, type QuickInputSession } from "./model";

const PROMPT_INDEX_LIMIT = 40;
const PROMPT_INDEX_CONCURRENCY = 6;

// eslint-disable-next-line complexity
function toQuickInputSession(input: {
  agent: Agent;
  workspace: WorkspaceDescriptor | undefined;
  hostLabel: string;
}): QuickInputSession {
  const projectName =
    input.workspace?.projectCustomName ||
    input.workspace?.projectDisplayName ||
    input.agent.projectPlacement?.projectName ||
    "";
  const workspaceName =
    input.workspace?.title ||
    input.workspace?.name ||
    input.agent.projectPlacement?.workspaceName ||
    "";
  return {
    serverId: input.agent.serverId,
    agentId: input.agent.id,
    workspaceId: input.agent.workspaceId ?? null,
    title: input.agent.title?.trim() || workspaceName || projectName,
    workspaceName,
    projectName,
    cwd: input.agent.cwd,
    status: input.agent.status,
    isRunning: input.agent.turn.phase === "open" || input.agent.status === "running",
    requiresAttention: Boolean(input.agent.requiresAttention),
    pendingPermissionCount: input.agent.pendingPermissions.length,
    lastActivityAt: input.agent.lastActivityAt,
    labels: input.agent.labels,
    hostLabel: input.hostLabel,
    provider: input.agent.provider,
    model: input.agent.runtimeInfo?.model ?? input.agent.model ?? null,
    thinkingOptionId:
      input.agent.runtimeInfo?.thinkingOptionId ?? input.agent.thinkingOptionId ?? null,
  };
}

export interface QuickInputSessionsResult {
  sessions: QuickInputSession[];
  isLoading: boolean;
  haveWorkspaces: boolean;
}

export function useQuickInputSessions(): QuickInputSessionsResult {
  const hosts = useHosts();
  const hostServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const agentsByServer = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, Agent> | undefined> = {};
      for (const serverId of hostServerIds) {
        result[serverId] = state.sessions[serverId]?.agents;
      }
      return result;
    }),
  );
  const workspacesByServer = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, WorkspaceDescriptor> | undefined> = {};
      for (const serverId of hostServerIds) {
        result[serverId] = state.sessions[serverId]?.workspaces;
      }
      return result;
    }),
  );
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );

  useEffect(() => {
    const releases = hostServerIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [hostServerIds, runtime]);

  return useMemo(() => {
    void runtimeVersion;
    const sessions: QuickInputSession[] = [];
    let haveWorkspaces = false;
    for (const host of hosts) {
      const workspaces = workspacesByServer[host.serverId];
      if (workspaces && workspaces.size > 0) {
        haveWorkspaces = true;
      }
      for (const agent of agentsByServer[host.serverId]?.values() ?? []) {
        const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
        const workspaceKey = resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId });
        const workspace = workspaceKey ? workspaces?.get(workspaceKey) : undefined;
        if (!isQuickInputCandidate(agent, workspace)) {
          continue;
        }
        sessions.push(toQuickInputSession({ agent, workspace, hostLabel: host.label }));
      }
    }
    const isLoading = hosts.some((host) => {
      const status = runtime.getSnapshot(host.serverId)?.agentDirectoryStatus;
      return status === "initial_loading" || status === "revalidating";
    });
    return { sessions, isLoading, haveWorkspaces };
  }, [agentsByServer, hosts, runtime, runtimeVersion, workspacesByServer]);
}

export function useQuickInputRecentPrompts(
  sessions: readonly QuickInputSession[],
  enabled: boolean,
): Readonly<Record<string, readonly string[]>> {
  const [promptsBySession, setPromptsBySession] = useState<Record<string, readonly string[]>>({});
  const attemptedRef = useRef(new Set<string>());
  const runtime = getHostRuntimeStore();

  const load = useCallback(async () => {
    const targets = sessions
      .filter((session) => !attemptedRef.current.has(quickInputSessionKey(session)))
      .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
      .slice(0, PROMPT_INDEX_LIMIT);
    if (targets.length === 0) {
      return;
    }
    for (const target of targets) {
      attemptedRef.current.add(quickInputSessionKey(target));
    }

    const nextEntries: Array<readonly [string, readonly string[]]> = [];
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(PROMPT_INDEX_CONCURRENCY, targets.length) },
      async () => {
        while (cursor < targets.length) {
          const target = targets[cursor];
          cursor += 1;
          const client = runtime.getClient(target.serverId);
          if (!client) {
            continue;
          }
          try {
            const payload = await client.listAgentTimelinePrompts(target.agentId);
            const recent = [...payload.prompts]
              .sort((left, right) => left.seq - right.seq)
              .slice(-6)
              .map((prompt) => prompt.preview)
              .filter(Boolean);
            if (recent.length > 0) {
              nextEntries.push([quickInputSessionKey(target), recent] as const);
            }
          } catch {
            // Recent context is a ranking aid; title/project matching still works without it.
          }
        }
      },
    );
    await Promise.all(workers);
    if (nextEntries.length === 0) {
      return;
    }
    setPromptsBySession((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, prompts] of nextEntries) {
        next[key] = prompts;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [runtime, sessions]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void load();
  }, [enabled, load]);

  return promptsBySession;
}

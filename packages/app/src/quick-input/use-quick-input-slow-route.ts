import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  quickInputSessionKey,
  type QuickInputConfidence,
  type QuickInputReason,
  type QuickInputSession,
} from "./model";
import { classifyQuickInputRouteError, type QuickInputSlowRouteErrorCode } from "./route-errors";

/* oxlint-disable max-nested-callbacks -- per-host routing promises must stay tied to one request sequence */

const SLOW_ROUTE_DEBOUNCE_MS = 700;
const SLOW_ROUTE_TIMEOUT_MS = 20_000;
const MAX_ROUTE_CANDIDATES = 40;

export type QuickInputSlowRouteStage = "preparing" | "thinking" | "validating" | "fallback";

export interface QuickInputSlowRouteProgress {
  stage: QuickInputSlowRouteStage;
  candidateCount: number;
  provider: AgentProvider | null;
  model: string | null;
}

export interface QuickInputSlowRouteState {
  status: "idle" | "loading" | "ready" | "error";
  orderedKeys: string[];
  reason: QuickInputReason | "none";
  confidence: QuickInputConfidence;
  explanation: string | null;
  error: string | null;
  errorCode: QuickInputSlowRouteErrorCode | null;
  errorProvider: AgentProvider | null;
  progress: QuickInputSlowRouteProgress | null;
}

const IDLE_STATE: QuickInputSlowRouteState = {
  status: "idle",
  orderedKeys: [],
  reason: "none",
  confidence: "none",
  explanation: null,
  error: null,
  errorCode: null,
  errorProvider: null,
  progress: null,
};

export function useQuickInputSlowRoute(input: {
  sessions: readonly QuickInputSession[];
  query: string;
  recentPromptsBySession: Readonly<Record<string, readonly string[]>>;
  localConfidence: QuickInputConfidence;
  selection: {
    provider: AgentProvider;
    model?: string | null;
    thinkingOptionId?: string | null;
  } | null;
  enabled: boolean;
}): QuickInputSlowRouteState {
  const { sessions, query, recentPromptsBySession, localConfidence, selection, enabled } = input;
  const [state, setState] = useState<QuickInputSlowRouteState>(IDLE_STATE);
  const requestSequenceRef = useRef(0);
  const sessionsRef = useRef(sessions);
  const recentPromptsRef = useRef(recentPromptsBySession);
  const selectionRef = useRef(selection);
  sessionsRef.current = sessions;
  recentPromptsRef.current = recentPromptsBySession;
  selectionRef.current = selection;
  const runtime = getHostRuntimeStore();
  const shouldRun = enabled && query.trim().length > 1 && localConfidence !== "high";
  const selectionSignature = selection
    ? `${selection.provider}:${selection.model ?? ""}:${selection.thinkingOptionId ?? ""}`
    : "";
  const candidateSignature = useMemo(
    () =>
      JSON.stringify(
        sessions.slice(0, MAX_ROUTE_CANDIDATES).map((session) => {
          const key = quickInputSessionKey(session);
          return [
            key,
            session.title,
            session.projectName,
            session.workspaceName,
            session.cwd,
            recentPromptsBySession[key]?.slice(-5) ?? [],
          ];
        }),
      ),
    [recentPromptsBySession, sessions],
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    const sequence = requestSequenceRef.current;
    if (!shouldRun) {
      setState((current) => (current.status === "idle" ? current : IDLE_STATE));
      return;
    }

    setState((current) => ({
      ...current,
      status: "loading",
      error: null,
      errorCode: null,
      errorProvider: null,
      progress: {
        stage: "preparing",
        candidateCount: Math.min(sessionsRef.current.length, MAX_ROUTE_CANDIDATES),
        provider: selectionRef.current?.provider ?? null,
        model: selectionRef.current?.model ?? null,
      },
    }));
    const timer = setTimeout(() => {
      const candidates = [...sessionsRef.current]
        .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
        .slice(0, MAX_ROUTE_CANDIDATES);
      setState((current) =>
        current.status === "loading" && current.progress
          ? {
              ...current,
              progress: { ...current.progress, candidateCount: candidates.length },
            }
          : current,
      );
      const byServer = new Map<string, QuickInputSession[]>();
      for (const session of candidates) {
        const group = byServer.get(session.serverId) ?? [];
        group.push(session);
        byServer.set(session.serverId, group);
      }

      void Promise.allSettled(
        Array.from(byServer.entries()).map(async ([serverId, serverSessions]) => {
          const client = runtime.getClient(serverId);
          if (!client) {
            throw new Error("Host is offline");
          }
          const response = await client.routeQuickInput(
            {
              query: query.trim(),
              candidates: serverSessions.map((session) => ({
                agentId: session.agentId,
                title: session.title,
                projectName: session.projectName,
                workspaceName: session.workspaceName,
                cwd: session.cwd,
                recentContext:
                  recentPromptsRef.current[quickInputSessionKey(session)]?.slice(-5) ?? [],
              })),
              selection: selectionRef.current ?? undefined,
            },
            {
              timeout: SLOW_ROUTE_TIMEOUT_MS,
              onProgress: (progress) => {
                if (requestSequenceRef.current !== sequence) {
                  return;
                }
                setState((current) =>
                  current.status === "loading"
                    ? {
                        ...current,
                        progress: {
                          stage: progress.stage,
                          candidateCount: progress.candidateCount,
                          provider: progress.provider,
                          model: progress.model,
                        },
                      }
                    : current,
                );
              },
            },
          );
          return { serverId, response };
        }),
      )
        .then((settled) => {
          if (requestSequenceRef.current !== sequence) {
            return undefined;
          }
          const responses = settled.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          if (responses.length === 0) {
            const failure = settled.find(
              (result): result is PromiseRejectedResult => result.status === "rejected",
            );
            throw failure?.reason ?? new Error("The model route is unavailable");
          }
          const orderedKeys = responses.flatMap(({ serverId, response }) =>
            response.agentIds.map((agentId) => `${serverId}:${agentId}`),
          );
          const primary =
            responses.find(({ response }) => response.agentIds.length > 0)?.response ??
            responses[0]?.response;
          const confidence = responses.some(({ response }) => response.confidence === "high")
            ? "high"
            : (primary?.confidence ?? "low");
          setState({
            status: "ready",
            orderedKeys,
            reason: primary?.reason ?? "none",
            confidence,
            explanation: primary?.explanation ?? null,
            error: null,
            errorCode: null,
            errorProvider: null,
            progress: null,
          });
          return true;
        })
        .catch((error: unknown) => {
          if (requestSequenceRef.current !== sequence) {
            return;
          }
          const classified = classifyQuickInputRouteError(error);
          setState({
            status: "error",
            orderedKeys: [],
            reason: "none",
            confidence: "none",
            explanation: null,
            error: error instanceof Error ? error.message : String(error),
            errorCode: classified.code,
            errorProvider: classified.provider,
            progress: null,
          });
        });
    }, SLOW_ROUTE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [candidateSignature, query, runtime, selectionSignature, shouldRun]);

  return state;
}

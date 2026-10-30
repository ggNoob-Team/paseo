import {
  compareMatchScores,
  fuzzyPolicyForToken,
  scoreMatch,
  type MatchScore,
} from "@getpaseo/protocol/search/text-match";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";

export interface QuickInputSession {
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  title: string;
  workspaceName: string;
  projectName: string;
  cwd: string;
  status: AgentLifecycleStatus;
  isRunning: boolean;
  requiresAttention: boolean;
  pendingPermissionCount: number;
  lastActivityAt: Date;
  labels: Record<string, string>;
  hostLabel: string;
  provider: AgentProvider;
  model: string | null;
  thinkingOptionId: string | null;
}

export type QuickInputReason = "title" | "project" | "recent" | "keyword";
export type QuickInputConfidence = "high" | "low" | "none";

export interface QuickInputResult {
  session: QuickInputSession;
  score: number;
  match: MatchScore;
  reason: QuickInputReason;
  matchedText: string | null;
  modelRanked?: boolean;
}

export interface QuickInputRanking {
  results: QuickInputResult[];
  confidence: QuickInputConfidence;
}

export type QuickInputSectionId = "active" | "recent" | "other";

export interface QuickInputSection {
  id: QuickInputSectionId;
  sessions: QuickInputSession[];
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HIGH_CONFIDENCE_MARGIN = 24;

const GROUP_WEIGHTS: Record<QuickInputReason, number> = {
  title: 0,
  project: 100,
  recent: 200,
  keyword: 300,
};

export function quickInputSessionKey(session: Pick<QuickInputSession, "serverId" | "agentId">) {
  return `${session.serverId}:${session.agentId}`;
}

export interface QuickInputModelSeed {
  provider: AgentProvider;
  model: string | null;
  thinkingOptionId: string | null;
}

/**
 * Quick input behaves like the last open session: inherit its model unless the
 * user explicitly picks another model in the quick input selector. Prefer the
 * active workspace, then the most recent session on the same host.
 */
export function selectQuickInputModelSeedSession(
  sessions: readonly QuickInputSession[],
  target: { serverId: string | null; workspaceId: string | null },
): QuickInputSession | null {
  if (!target.serverId) {
    return null;
  }
  const onServer = sessions.filter((session) => session.serverId === target.serverId);
  const inWorkspace =
    target.workspaceId === null
      ? []
      : onServer.filter((session) => session.workspaceId === target.workspaceId);
  const pool = (inWorkspace.length > 0 ? inWorkspace : onServer)
    .filter((session) => session.model !== null)
    .sort(compareSessionsByActivity);
  return pool[0] ?? null;
}

export function quickInputModelSeedFromSession(
  session: QuickInputSession | null,
): QuickInputModelSeed | null {
  if (!session) {
    return null;
  }
  return {
    provider: session.provider,
    model: session.model,
    thinkingOptionId: session.thinkingOptionId,
  };
}

function isActiveSession(session: QuickInputSession): boolean {
  return session.isRunning || session.requiresAttention || session.pendingPermissionCount > 0;
}

function compareSessionsByActivity(left: QuickInputSession, right: QuickInputSession): number {
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

function compareActiveSessions(left: QuickInputSession, right: QuickInputSession): number {
  const attentionDelta =
    Number(right.requiresAttention || right.pendingPermissionCount > 0) -
    Number(left.requiresAttention || left.pendingPermissionCount > 0);
  return attentionDelta || compareSessionsByActivity(left, right);
}

export function groupQuickInputSessions(
  sessions: readonly QuickInputSession[],
  now = Date.now(),
): QuickInputSection[] {
  const active: QuickInputSession[] = [];
  const recent: QuickInputSession[] = [];
  const other: QuickInputSession[] = [];
  for (const session of sessions) {
    if (isActiveSession(session)) {
      active.push(session);
    } else if (now - session.lastActivityAt.getTime() <= RECENT_WINDOW_MS) {
      recent.push(session);
    } else {
      other.push(session);
    }
  }
  active.sort(compareActiveSessions);
  recent.sort(compareSessionsByActivity);
  other.sort(compareSessionsByActivity);
  const sections: QuickInputSection[] = [
    { id: "active", sessions: active },
    { id: "recent", sessions: recent },
    { id: "other", sessions: other },
  ];
  return sections.filter((section) => section.sessions.length > 0);
}

function fieldsForReason(
  session: QuickInputSession,
  recentPrompts: readonly string[],
  reason: QuickInputReason,
): string[] {
  switch (reason) {
    case "title":
      return session.title ? [session.title] : [];
    case "project":
      return [session.projectName, session.workspaceName].filter(Boolean);
    case "recent":
      return [...recentPrompts];
    case "keyword":
      return [session.cwd, ...Object.values(session.labels)].filter(Boolean);
  }
}

interface QueryTokenMatch {
  score: MatchScore;
  reason: QuickInputReason;
  text: string;
  rank: number;
}

function scoreTokenInFields(
  token: string,
  fields: readonly string[],
): { score: MatchScore; text: string } | null {
  let best: { score: MatchScore; text: string } | null = null;
  for (const field of fields) {
    const score = scoreMatch(token, field, {
      fuzzy: fuzzyPolicyForToken(token),
      subsequence: true,
    });
    if (!score) continue;
    if (!best || compareMatchScores(score, best.score) < 0) {
      best = { score, text: field };
    }
  }
  return best;
}

/**
 * Routing queries are usually natural language, not exact titles. Split Latin
 * words from Han text and turn long Han runs into overlapping bigrams so a query
 * such as `review mindmap bug修复代码` can still use `mindmap` and `bug` as
 * evidence instead of being discarded as one unmatched string.
 */
function tokenizeQuickInputQuery(query: string): string[] {
  const segments =
    query
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
  const tokens: string[] = [];
  for (const segment of segments) {
    if (/^\p{Script=Han}+$/u.test(segment)) {
      if (segment.length <= 2) {
        tokens.push(segment);
        continue;
      }
      for (let index = 0; index < segment.length - 1; index += 1) {
        tokens.push(segment.slice(index, index + 2));
      }
      continue;
    }
    if (segment.length >= 2) {
      tokens.push(segment);
    }
  }
  return Array.from(new Set(tokens));
}

function queryTokenWeight(token: string): number {
  return Math.max(2, Math.min(token.length, 12));
}

function numericScore(reason: QuickInputReason, match: MatchScore): number {
  return (
    GROUP_WEIGHTS[reason] +
    match.tier * 12 +
    Math.min(match.offset, 60) +
    Math.min(match.spread ?? 0, 30) * 0.05
  );
}

function findBestTokenMatch(input: {
  token: string;
  session: QuickInputSession;
  recentPrompts: readonly string[];
}): QueryTokenMatch | null {
  let best: QueryTokenMatch | null = null;
  for (const reason of ["title", "project", "recent", "keyword"] as const) {
    const scored = scoreTokenInFields(
      input.token,
      fieldsForReason(input.session, input.recentPrompts, reason),
    );
    if (!scored) continue;
    const candidate = {
      score: scored.score,
      reason,
      text: scored.text,
      rank: numericScore(reason, scored.score),
    };
    if (!best || candidate.rank < best.rank) {
      best = candidate;
    }
  }
  return best;
}

function scoreSession(input: {
  query: string;
  session: QuickInputSession;
  recentPrompts: readonly string[];
}): QuickInputResult | null {
  const tokens = tokenizeQuickInputQuery(input.query);
  if (tokens.length === 0) {
    return null;
  }

  let totalWeight = 0;
  let matchedWeight = 0;
  let matchedTokenCount = 0;
  let best: QueryTokenMatch | null = null;
  for (const token of tokens) {
    totalWeight += queryTokenWeight(token);
    const matched = findBestTokenMatch({
      token,
      session: input.session,
      recentPrompts: input.recentPrompts,
    });
    if (!matched) continue;
    matchedTokenCount += 1;
    matchedWeight += queryTokenWeight(token);
    if (!best || matched.rank < best.rank) {
      best = matched;
    }
  }

  if (!best) return null;
  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const visibleAnchor =
    (best.reason === "title" || best.reason === "project") && best.score.tier <= 4;
  const enoughEvidence = matchedTokenCount >= 2 || best.score.tier <= 2;
  if (!enoughEvidence || (!visibleAnchor && coverage < 0.5)) {
    return null;
  }

  return {
    session: input.session,
    score: -matchedWeight * 100 + best.rank,
    match: best.score,
    reason: best.reason,
    matchedText: best.text,
  };
}

export function rankQuickInputSessions(input: {
  sessions: readonly QuickInputSession[];
  query: string;
  recentPromptsBySession?: Readonly<Record<string, readonly string[]>>;
}): QuickInputRanking {
  const query = input.query.trim();
  if (!query) {
    return { results: [], confidence: "none" };
  }

  const results = input.sessions
    .map((session) =>
      scoreSession({
        query,
        session,
        recentPrompts: input.recentPromptsBySession?.[quickInputSessionKey(session)] ?? [],
      }),
    )
    .filter((result): result is QuickInputResult => result !== null)
    .sort(
      (left, right) =>
        left.score - right.score || compareSessionsByActivity(left.session, right.session),
    );

  if (results.length === 0) {
    return { results, confidence: "none" };
  }

  const top = results[0];
  const margin = results[1] ? results[1].score - top.score : Number.POSITIVE_INFINITY;
  const visibleReason = top.reason === "title" || top.reason === "project";
  const strongMatch = top.match.tier <= 4;
  const confidence: QuickInputConfidence =
    visibleReason && strongMatch && margin >= HIGH_CONFIDENCE_MARGIN ? "high" : "low";
  return { results, confidence };
}

export function applyQuickInputModelOrdering(input: {
  results: readonly QuickInputResult[];
  sessions: readonly QuickInputSession[];
  orderedKeys: readonly string[];
  reason: QuickInputReason | "none";
}): QuickInputResult[] {
  if (input.orderedKeys.length === 0) {
    return [...input.results];
  }

  const sessionsByKey = new Map(
    input.sessions.map((session) => [quickInputSessionKey(session), session] as const),
  );
  const resultsByKey = new Map(
    input.results.map((result) => [quickInputSessionKey(result.session), result] as const),
  );
  const ordered: QuickInputResult[] = [];
  const seen = new Set<string>();
  const reason = input.reason === "none" ? "keyword" : input.reason;

  for (const key of input.orderedKeys) {
    if (seen.has(key)) {
      continue;
    }
    const existing = resultsByKey.get(key);
    if (existing) {
      ordered.push({ ...existing, reason, modelRanked: true });
      seen.add(key);
      continue;
    }
    const session = sessionsByKey.get(key);
    if (!session) {
      continue;
    }
    ordered.push({
      session,
      score: 0,
      match: { tier: 0, offset: 0 },
      reason,
      matchedText: null,
      modelRanked: true,
    });
    seen.add(key);
  }

  for (const result of input.results) {
    const key = quickInputSessionKey(result.session);
    if (!seen.has(key)) {
      ordered.push(result);
    }
  }
  return ordered;
}

import { truncateTerminalText } from "./terminal-output";

export interface CommandPlanningPromptInput {
  request: string;
  cwd: string;
}

const MAX_SUMMARY_OUTPUT_CHARS = 8_000;

/**
 * Asks the terminal operator to translate a request into shell commands for the
 * visible terminal. The operator must not execute them itself; the caller
 * writes the returned lines to the terminal PTY.
 */
export function buildCommandPlanningPrompt({ request, cwd }: CommandPlanningPromptInput): string {
  return [
    "Translate the user request below into shell commands for an existing terminal.",
    `The terminal is already open in ${cwd}.`,
    "Reply with only the commands to type into that terminal, one command per line.",
    "Do not use markdown fences, add explanations, ask questions, or run the commands yourself.",
    "Use non-interactive commands and prefer safe, read-only operations.",
    "If no shell command is needed, reply with exactly NO_COMMAND.",
    "",
    "User request:",
    request,
  ].join("\n");
}

export interface CommandSummaryPromptInput {
  request: string;
  cwd: string;
  commands: string[];
  output: string;
}

/**
 * Asks the same isolated terminal operator to explain what the visible terminal
 * just did. The command output is captured from the PTY, not re-run.
 */
export function buildCommandSummaryPrompt({
  request,
  cwd,
  commands,
  output,
}: CommandSummaryPromptInput): string {
  const captured = truncateTerminalText(output.trim(), MAX_SUMMARY_OUTPUT_CHARS);
  return [
    "The commands below were just executed in the user's visible terminal.",
    `Terminal cwd: ${cwd}`,
    "",
    "User request:",
    request,
    "",
    "Commands:",
    ...commands.map((command) => `$ ${command}`),
    "",
    "Captured terminal output:",
    captured || "(no output captured)",
    "",
    "Write a concise summary in the same language as the user request: what ran, what the results mean, and any errors or next steps.",
    "Do not output shell commands. Do not ask questions.",
  ].join("\n");
}

const FENCED_BLOCK = /```(?:bash|sh|shell|zsh|console)?[^\n]*\n([\s\S]*?)```/gi;

function stripCommandPrefix(line: string): string {
  let next = line.trim();
  if (next.startsWith("$ ")) {
    next = next.slice(2).trim();
  } else if (next.startsWith("> ")) {
    next = next.slice(2).trim();
  }
  if (next.startsWith("`") && next.endsWith("`") && next.length > 1) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

/**
 * Extracts commands from a planning reply. Prefers fenced code blocks; otherwise
 * treats non-empty lines as commands so operators that skip fences still work.
 */
export function parseCommandPlan(reply: string): string[] {
  const fenced: string[] = [];
  for (const match of reply.matchAll(FENCED_BLOCK)) {
    if (match[1]) {
      fenced.push(match[1]);
    }
  }
  const body = fenced.length > 0 ? fenced.join("\n") : reply;
  const commands: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripCommandPrefix(rawLine);
    if (!line || /^NO_COMMAND$/i.test(line) || line.startsWith("```")) {
      continue;
    }
    commands.push(line);
  }
  return commands;
}

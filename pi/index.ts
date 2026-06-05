import { ensureGitWorktreeSessions, formatWorktreeSessionsResult } from "../src/worktree-sessions.js";
import type { WorktreeSessionsResult } from "../src/worktree-sessions.js";

type NotificationLevel = "info" | "warning" | "error";

type PiUi = {
  notify(message: string, level: NotificationLevel): void | Promise<void>;
  setStatus(key: string, value: string | undefined): void;
};

type PiContext = {
  cwd: string;
  ui: PiUi;
};

type PiApi = {
  on(eventName: "session_start", handler: (event: unknown, ctx: PiContext) => void | Promise<void>): void;
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: PiContext) => void | Promise<void>;
    },
  ): void;
};

const STATUS_KEY = "worktree-sessions";

/**
 * Pi package entrypoint. Keeps linked git worktrees pointed at the main
 * worktree's session store so every checkout sees the same conversation list.
 */
export default function worktreeSessionsPiExtension(pi: PiApi): void {
  pi.on("session_start", async (_event, ctx) => {
    const result = ensureGitWorktreeSessions(ctx.cwd);
    updateStatus(ctx, result);

    if (result.kind === "git" && result.changed.length > 0) {
      await ctx.ui.notify(`Shared pi sessions linked at ${result.sharedSessionDir}`, "info");
    }

    for (const warning of result.warnings) {
      await ctx.ui.notify(warning, "warning");
    }
  });

  pi.registerCommand("worktree-sessions", {
    description: "Link git worktree pi session directories to the main worktree",
    handler: async (_args, ctx) => {
      const result = ensureGitWorktreeSessions(ctx.cwd);
      updateStatus(ctx, result);

      const summary = formatWorktreeSessionsResult(result);
      if (result.kind === "git") {
        await ctx.ui.notify(summary, result.warnings.length > 0 ? "warning" : "info");
        return;
      }

      await ctx.ui.notify(summary, "info");
    },
  });
}

function updateStatus(ctx: PiContext, result: WorktreeSessionsResult): void {
  if (result.kind !== "git") {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const label = result.isMainWorktree ? "sessions: main" : "sessions: shared";
  ctx.ui.setStatus(STATUS_KEY, label);
}

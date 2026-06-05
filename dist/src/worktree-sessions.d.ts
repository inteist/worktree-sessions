export type WorktreeSessionsResult = GitWorktreeSessionsResult | NotGitWorktreeSessionsResult;
export interface NotGitWorktreeSessionsResult {
    kind: "not-git";
    changed: string[];
    warnings: string[];
}
export interface GitWorktreeSessionsResult {
    kind: "git";
    mainRoot: string;
    worktreeRoot: string;
    isMainWorktree: boolean;
    sharedSessionDir: string;
    changed: string[];
    warnings: string[];
}
/**
 * Ensures all known worktrees for the current git repository share the main
 * worktree's `.pi/sessions` directory. This is intentionally idempotent so it
 * can run on every session start and from agent-specific commands.
 */
export declare function ensureGitWorktreeSessions(cwd: string): WorktreeSessionsResult;
export declare function formatWorktreeSessionsResult(result: WorktreeSessionsResult): string;
//# sourceMappingURL=worktree-sessions.d.ts.map
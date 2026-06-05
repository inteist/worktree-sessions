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
    registerCommand(name: string, options: {
        description: string;
        handler: (args: string, ctx: PiContext) => void | Promise<void>;
    }): void;
};
/**
 * Pi package entrypoint. Keeps linked git worktrees pointed at the main
 * worktree's session store so every checkout sees the same conversation list.
 */
export default function worktreeSessionsPiExtension(pi: PiApi): void;
export {};
//# sourceMappingURL=index.d.ts.map
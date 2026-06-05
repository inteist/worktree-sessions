# worktree-sessions

Package/Extension that makes linked git worktrees share one session store.

The implementation is split into shared logic and agent-specific adapters:

- `src/worktree-sessions.ts` contains the reusable git/session-linking logic.
- `pi/index.ts` is the Pi adapter that wires the shared logic into Pi lifecycle
  events and the `/worktree-sessions` command.

The npm package publishes compiled JavaScript and declarations from `dist/`.

When Pi starts inside a git repository, the adapter finds the repository's
main worktree from `git rev-parse --git-common-dir`. It then uses the main
worktree's `.pi/sessions` directory as the physical session store and symlinks
Pi's per-worktree default session directories to it.

This means:

- sessions started in the main worktree are visible from linked worktrees;
- sessions started in linked worktrees are saved back into the main worktree;
- newly-created linked worktrees are linked automatically the first time pi is
  launched inside them;
- existing `.jsonl` session files in old per-worktree session buckets are moved
  into the shared store.

## Install

From npm:

```bash
pi install npm:worktree-sessions
```

## Command

Inside pi, run:

```text
/worktree-sessions
```

The command re-runs the linking step and reports the shared session directory.

## Development

```bash
npm install
npm run check
npm run build
```

Add the absolute package path to `~/.pi/agent/settings.json` under
`packages`.

```json
{
  "packages": [
    "~/Projects/pi-extensions/worktree-sessions/",
}
```

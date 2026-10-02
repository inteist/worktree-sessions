import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { ensureGitWorktreeSessions } from "../dist/src/worktree-sessions.js";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "worktree-sessions-"));
  const repoPath = join(root, "repo");
  const agentDir = join(root, "agent");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(join(agentDir, "sessions"), { recursive: true });
  execFileSync("git", ["init", "--quiet", repoPath]);
  const repo = realpathSync(repoPath);

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  return {
    root,
    repo,
    agentDir,
    cleanup() {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function defaultSessionDir(agentDir, cwd) {
  const safePath = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(agentDir, "sessions", safePath);
}

function writeSession(path, cwd) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ type: "session", version: 3, id: "test", cwd })}\n`);
}

test("repairs a stale session symlink and migrates only sessions for that worktree", { concurrency: false }, () => {
  const fixture = createFixture();
  try {
    const staleTarget = join(fixture.root, "old-shared-sessions");
    const expectedTarget = join(fixture.repo, ".pi", "sessions");
    const linkDir = defaultSessionDir(fixture.agentDir, fixture.repo);
    const matchingSession = "matching.jsonl";
    const unrelatedSession = "unrelated.jsonl";

    mkdirSync(staleTarget, { recursive: true });
    writeSession(join(staleTarget, matchingSession), fixture.repo);
    writeSession(join(staleTarget, unrelatedSession), join(fixture.root, "another-repo"));
    symlinkSync(staleTarget, linkDir, "dir");

    const result = ensureGitWorktreeSessions(fixture.repo);

    assert.equal(result.kind, "git");
    assert.deepEqual(result.warnings, []);
    assert.equal(resolve(dirname(linkDir), readlinkSync(linkDir)), expectedTarget);
    assert.equal(resolve(result.sharedSessionDir), expectedTarget);
    assert.equal(result.changed.some((change) => change.startsWith(`Relinked ${linkDir}`)), true);
    assert.equal(existsSync(join(expectedTarget, matchingSession)), true);
    assert.equal(existsSync(join(staleTarget, unrelatedSession)), true);
    assert.equal(existsSync(join(staleTarget, matchingSession)), false);

    const secondResult = ensureGitWorktreeSessions(fixture.repo);
    assert.deepEqual(secondResult.warnings, []);
    assert.deepEqual(secondResult.changed, []);
  } finally {
    fixture.cleanup();
  }
});

test("repairs a broken session symlink", { concurrency: false }, () => {
  const fixture = createFixture();
  try {
    const expectedTarget = join(fixture.repo, ".pi", "sessions");
    const linkDir = defaultSessionDir(fixture.agentDir, fixture.repo);
    symlinkSync(join(fixture.root, "missing-target"), linkDir, "dir");

    const result = ensureGitWorktreeSessions(fixture.repo);

    assert.equal(result.kind, "git");
    assert.deepEqual(result.warnings, []);
    assert.equal(resolve(dirname(linkDir), readlinkSync(linkDir)), expectedTarget);
  } finally {
    fixture.cleanup();
  }
});

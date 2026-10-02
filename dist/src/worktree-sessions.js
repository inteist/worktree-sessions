import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
const SESSION_EXCLUDE_LINE = ".pi/sessions/";
const SESSION_HEADER_MAX_BYTES = 64 * 1024;
/**
 * Ensures all known worktrees for the current git repository share the main
 * worktree's `.pi/sessions` directory. This is intentionally idempotent so it
 * can run on every session start and from agent-specific commands.
 */
export function ensureGitWorktreeSessions(cwd) {
    const gitProject = discoverGitProject(cwd);
    if (!gitProject) {
        return { kind: "not-git", changed: [], warnings: [] };
    }
    const sharedSessionDir = join(gitProject.mainRoot, ".pi", "sessions");
    const changed = [];
    const warnings = [];
    mkdirSync(sharedSessionDir, { recursive: true });
    const excludeResult = ensureGitInfoExclude(gitProject.commonGitDir);
    changed.push(...excludeResult.changed);
    warnings.push(...excludeResult.warnings);
    const worktreeRoots = new Set([gitProject.mainRoot, gitProject.worktreeRoot, ...gitProject.worktrees]);
    for (const worktreeRoot of worktreeRoots) {
        const defaultDir = getDefaultSessionDir(worktreeRoot);
        const linkResult = ensureDirectoryLinked(defaultDir, sharedSessionDir, worktreeRoot);
        changed.push(...linkResult.changed);
        warnings.push(...linkResult.warnings);
    }
    return {
        kind: "git",
        mainRoot: gitProject.mainRoot,
        worktreeRoot: gitProject.worktreeRoot,
        isMainWorktree: gitProject.mainRoot === gitProject.worktreeRoot,
        sharedSessionDir,
        changed,
        warnings,
    };
}
export function formatWorktreeSessionsResult(result) {
    if (result.kind !== "git") {
        return "Not inside a git worktree; pi session sharing was not changed.";
    }
    const changed = result.changed.length > 0 ? `${result.changed.length} link/update(s)` : "already linked";
    const warnings = result.warnings.length > 0 ? `, ${result.warnings.length} warning(s)` : "";
    return `Pi sessions are shared via ${result.sharedSessionDir} (${changed}${warnings}).`;
}
function discoverGitProject(cwd) {
    try {
        const output = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel", "--git-common-dir"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        })
            .trim()
            .split(/\r?\n/);
        const worktreeRoot = resolve(output[0]);
        const commonGitDir = resolve(worktreeRoot, output[1]);
        const mainRoot = dirname(commonGitDir);
        return {
            worktreeRoot,
            commonGitDir,
            mainRoot,
            worktrees: listKnownWorktrees(mainRoot),
        };
    }
    catch {
        return null;
    }
}
function listKnownWorktrees(mainRoot) {
    try {
        const output = execFileSync("git", ["-C", mainRoot, "worktree", "list", "--porcelain"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return output
            .split(/\r?\n/)
            .filter((line) => line.startsWith("worktree "))
            .map((line) => resolve(line.slice("worktree ".length)))
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function ensureGitInfoExclude(commonGitDir) {
    const changed = [];
    const warnings = [];
    const excludePath = join(commonGitDir, "info", "exclude");
    try {
        mkdirSync(dirname(excludePath), { recursive: true });
        const existing = existsSync(excludePath) ? readTextFile(excludePath) : "";
        const hasLine = existing.split(/\r?\n/).some((line) => line.trim() === SESSION_EXCLUDE_LINE);
        if (!hasLine) {
            appendFileSync(excludePath, `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${SESSION_EXCLUDE_LINE}\n`);
            changed.push(`Added ${SESSION_EXCLUDE_LINE} to ${excludePath}`);
        }
    }
    catch (error) {
        warnings.push(`Could not update ${excludePath}: ${formatError(error)}`);
    }
    return { changed, warnings };
}
function readTextFile(path) {
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return "";
    }
}
function getDefaultSessionDir(cwd) {
    const safePath = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return join(getAgentDir(), "sessions", safePath);
}
function getAgentDir() {
    return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
function ensureDirectoryLinked(linkDir, sharedSessionDir, worktreeRoot) {
    const changed = [];
    const warnings = [];
    if (sameResolvedPath(linkDir, sharedSessionDir)) {
        return { changed, warnings };
    }
    mkdirSync(dirname(linkDir), { recursive: true });
    let stat;
    try {
        stat = lstatSync(linkDir);
    }
    catch (error) {
        if (isNotFoundError(error)) {
            createDirectorySymlink(linkDir, sharedSessionDir, changed);
        }
        else {
            warnings.push(`Could not inspect ${linkDir}: ${formatError(error)}`);
        }
        return { changed, warnings };
    }
    if (stat.isSymbolicLink()) {
        const rawTarget = readlinkSync(linkDir);
        const target = resolve(dirname(linkDir), rawTarget);
        if (sameResolvedPath(target, sharedSessionDir)) {
            return { changed, warnings };
        }
        const migration = moveLinkedSessionsForWorktree(target, sharedSessionDir, worktreeRoot);
        changed.push(...migration.changed);
        warnings.push(...migration.warnings);
        relinkDirectorySymlink(linkDir, rawTarget, target, sharedSessionDir, changed, warnings);
        return { changed, warnings };
    }
    if (stat.isDirectory()) {
        moveExistingSessions(linkDir, sharedSessionDir, worktreeRoot, changed, warnings);
        replacePathWithSymlink(linkDir, sharedSessionDir, changed, warnings);
        return { changed, warnings };
    }
    const backupPath = uniqueBackupPath(linkDir, "pre-worktree-session-link");
    renameSync(linkDir, backupPath);
    changed.push(`Moved non-directory ${linkDir} to ${backupPath}`);
    createDirectorySymlink(linkDir, sharedSessionDir, changed);
    return { changed, warnings };
}
function moveLinkedSessionsForWorktree(fromDir, sharedSessionDir, worktreeRoot) {
    const changed = [];
    const warnings = [];
    let entries;
    try {
        entries = readdirSync(fromDir, { withFileTypes: true });
    }
    catch (error) {
        if (!isNotFoundError(error)) {
            warnings.push(`Could not inspect old session target ${fromDir}: ${formatError(error)}`);
        }
        return { changed, warnings };
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
            continue;
        }
        const sourcePath = join(fromDir, entry.name);
        const sessionCwd = readSessionCwd(sourcePath);
        if (!sessionCwd || !sameResolvedPath(sessionCwd, worktreeRoot)) {
            continue;
        }
        const targetPath = uniqueSessionTarget(sharedSessionDir, entry.name, worktreeRoot);
        try {
            renameSync(sourcePath, targetPath);
            changed.push(`Moved ${sourcePath} to ${targetPath}`);
        }
        catch (error) {
            warnings.push(`Could not move ${sourcePath}: ${formatError(error)}`);
        }
    }
    return { changed, warnings };
}
function moveExistingSessions(fromDir, sharedSessionDir, worktreeRoot, changed, warnings) {
    for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
            continue;
        }
        const sourcePath = join(fromDir, entry.name);
        const targetPath = uniqueSessionTarget(sharedSessionDir, entry.name, worktreeRoot);
        try {
            renameSync(sourcePath, targetPath);
            changed.push(`Moved ${sourcePath} to ${targetPath}`);
        }
        catch (error) {
            warnings.push(`Could not move ${sourcePath}: ${formatError(error)}`);
        }
    }
}
function replacePathWithSymlink(linkDir, sharedSessionDir, changed, warnings) {
    const remaining = readdirSync(linkDir);
    if (remaining.length === 0) {
        rmSync(linkDir, { recursive: true, force: true });
        createDirectorySymlink(linkDir, sharedSessionDir, changed);
        return;
    }
    const backupPath = uniqueBackupPath(linkDir, "pre-worktree-session-link");
    try {
        renameSync(linkDir, backupPath);
        changed.push(`Moved remaining session-dir contents from ${linkDir} to ${backupPath}`);
        createDirectorySymlink(linkDir, sharedSessionDir, changed);
    }
    catch (error) {
        warnings.push(`Could not replace ${linkDir} with a symlink: ${formatError(error)}`);
    }
}
function createDirectorySymlink(linkDir, sharedSessionDir, changed) {
    const relativeTarget = relative(dirname(linkDir), sharedSessionDir) || sharedSessionDir;
    symlinkSync(relativeTarget, linkDir, "dir");
    changed.push(`Linked ${linkDir} -> ${sharedSessionDir}`);
}
function relinkDirectorySymlink(linkDir, rawTarget, oldTarget, sharedSessionDir, changed, warnings) {
    try {
        unlinkSync(linkDir);
        const relativeTarget = relative(dirname(linkDir), sharedSessionDir) || sharedSessionDir;
        symlinkSync(relativeTarget, linkDir, "dir");
        changed.push(`Relinked ${linkDir} from ${oldTarget} to ${sharedSessionDir}`);
    }
    catch (error) {
        if (!pathExists(linkDir)) {
            try {
                symlinkSync(rawTarget, linkDir, "dir");
            }
            catch (restoreError) {
                warnings.push(`Could not restore ${linkDir} -> ${oldTarget}: ${formatError(restoreError)}`);
            }
        }
        warnings.push(`Could not relink ${linkDir} to ${sharedSessionDir}: ${formatError(error)}`);
    }
}
function readSessionCwd(path) {
    let descriptor;
    try {
        descriptor = openSync(path, "r");
        const buffer = Buffer.alloc(SESSION_HEADER_MAX_BYTES);
        const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
        const newlineIndex = buffer.indexOf("\n", 0);
        const lineEnd = newlineIndex >= 0 && newlineIndex < bytesRead ? newlineIndex : bytesRead;
        const header = JSON.parse(buffer.toString("utf8", 0, lineEnd));
        return header.type === "session" && typeof header.cwd === "string" ? resolve(header.cwd) : undefined;
    }
    catch {
        return undefined;
    }
    finally {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
    }
}
function uniqueSessionTarget(sharedSessionDir, fileName, worktreeRoot) {
    let targetPath = join(sharedSessionDir, fileName);
    if (!existsSync(targetPath)) {
        return targetPath;
    }
    const suffix = sanitizePathSegment(worktreeRoot);
    const dotIndex = fileName.lastIndexOf(".");
    const stem = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex >= 0 ? fileName.slice(dotIndex) : "";
    for (let index = 1; index < 1000; index++) {
        targetPath = join(sharedSessionDir, `${stem}_from-${suffix}_${index}${extension}`);
        if (!existsSync(targetPath)) {
            return targetPath;
        }
    }
    return join(sharedSessionDir, `${stem}_from-${suffix}_${Date.now()}${extension}`);
}
function uniqueBackupPath(path, label) {
    for (let index = 1; index < 1000; index++) {
        const candidate = `${path}.${label}-${Date.now()}-${index}`;
        if (!existsSync(candidate)) {
            return candidate;
        }
    }
    return `${path}.${label}-${Date.now()}`;
}
function sanitizePathSegment(path) {
    return resolve(path).replace(/^[ /\\]+/, "").replace(/[/\\:]/g, "-");
}
function sameResolvedPath(a, b) {
    return resolve(a) === resolve(b) || realPath(a) === realPath(b);
}
function realPath(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return resolve(path);
    }
}
function pathExists(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch {
        return false;
    }
}
function isNotFoundError(error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=worktree-sessions.js.map
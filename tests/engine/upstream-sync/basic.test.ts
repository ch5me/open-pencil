import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const script = join(import.meta.dir, "../../../scripts/upstream-sync.ts");

setDefaultTimeout(20_000);

function command(args: string[], cwd: string, allowFailure = false) {
  const result = Bun.spawnSync(args, { cwd, stderr: "pipe", stdout: "pipe" });
  const output = {
    code: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
  if (!allowFailure && output.code !== 0) {
    throw new Error(`${args.join(" ")}\n${output.stderr}\n${output.stdout}`);
  }
  return output;
}

function git(cwd: string, ...args: string[]) {
  return command(["git", ...args], cwd);
}

function commit(cwd: string, message: string) {
  git(cwd, "add", ".");
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", message);
}

function fixture(conflict = false) {
  const root = mkdtempSync(join(tmpdir(), "open-pencil-upstream-sync-"));
  roots.push(root);
  const upstream = join(root, "upstream");
  const fork = join(root, "fork");
  git(root, "init", "-b", "master", upstream);
  writeFileSync(join(upstream, "shared.txt"), "base\n");
  commit(upstream, "base");
  git(root, "clone", upstream, fork);
  git(fork, "remote", "rename", "origin", "upstream");
  git(fork, "remote", "add", "origin", upstream);
  git(fork, "branch", "private-main");
  git(fork, "worktree", "add", join(root, "worktree"), "private-main");
  const worktree = join(root, "worktree");
  if (conflict) {
    writeFileSync(join(worktree, "shared.txt"), "fork\n");
    commit(worktree, "fork change");
  } else {
    writeFileSync(join(worktree, "fork.txt"), "fork\n");
    commit(worktree, "fork change");
  }
  writeFileSync(join(upstream, conflict ? "shared.txt" : "upstream.txt"), "upstream\n");
  commit(upstream, "upstream change");
  const config = {
    schema: "ch5.upstream-sync.config.v1",
    upstream: { remote: "upstream", url: upstream, branch: "master" },
    target: { remote: "origin", branch: "master" },
    thresholds: { maxUpstreamCommits: 5, maxChangedFiles: 5, maxConflicts: 0 },
    criticalPaths: [],
    verification: { commands: ["true"] },
    commit: { messagePrefix: "chore(upstream): merge" },
    lockFile: ".ch5/upstream-sync.lock.json",
    requireManagedWorktree: true,
  };
  mkdirSync(join(worktree, ".ch5"), { recursive: true });
  writeFileSync(join(worktree, ".ch5/upstream-sync.json"), `${JSON.stringify(config, null, 2)}\n`);
  commit(worktree, "add config");
  return worktree;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("upstream sync", () => {
  test("classifies a small conflict-free update as routine", () => {
    const cwd = fixture();
    const result = command(["bun", script, "inspect", "--json"], cwd);
    const report = JSON.parse(result.stdout);
    expect(report.classification).toBe("routine");
    expect(report.counts.upstreamCommits).toBe(1);
    expect(report.counts.conflicts).toBe(0);
  });

  test("blocks conflicting drift without mutating the worktree", () => {
    const cwd = fixture(true);
    const inspectResult = command(["bun", script, "inspect", "--json"], cwd);
    expect(JSON.parse(inspectResult.stdout).classification).toBe("program");
    const mergeResult = command(["bun", script, "merge"], cwd, true);
    expect(mergeResult.code).toBe(1);
    expect(mergeResult.stderr).toContain("UPSTREAM_SYNC_PROGRAM_REQUIRED");
    expect(readFileSync(join(cwd, "shared.txt"), "utf8")).toBe("fork\n");
    expect(git(cwd, "status", "--porcelain").stdout).toBe("");
  });
});

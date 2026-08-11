import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TEST_FILE = "tests/engine/editor/assets-storage.test.ts";
const TEST_IDENTITY =
  "rejects missing, released, and colliding archive references before head mutation";
const SOURCE_FILE = "packages/core/src/editor/storage/store.ts";
const GUARD = "if (!staged.has(revisionId) && !known.has(revisionId)) {";
const SEEDED_GUARD = "if (false && !staged.has(revisionId) && !known.has(revisionId)) {";

interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
}

interface ProofReport {
  readonly proof: "PROOF-GAP-132";
  readonly state: "PROVED" | "UNKNOWN";
  readonly commit: string;
  readonly runtime: string;
  readonly testFile: string;
  readonly testIdentity: string;
  readonly scenarios: number;
  readonly baselineExitCode: number;
  readonly seededDefectExitCode: number;
  readonly seededOutputContainsIdentity: boolean;
  readonly consumingEffect: "UNKNOWN";
  readonly reason?: string;
}

function run(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, CH5_RAW_TEST_OK: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}\n${result.stderr.toString()}`.trim(),
  };
}

function fail(report: ProofReport): never {
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const root = resolve(import.meta.dir, "..");
const commitResult = run(["git", "rev-parse", "HEAD"], root);
const commit = commitResult.output;
const unknown = (
  reason: string,
  baselineExitCode = -1,
  seededDefectExitCode = -1,
): ProofReport => ({
  proof: "PROOF-GAP-132",
  state: "UNKNOWN",
  commit,
  runtime: `bun-${Bun.version}`,
  testFile: TEST_FILE,
  testIdentity: TEST_IDENTITY,
  scenarios: 0,
  baselineExitCode,
  seededDefectExitCode,
  seededOutputContainsIdentity: false,
  consumingEffect: "UNKNOWN",
  reason,
});

if (commitResult.exitCode !== 0 || !commit) fail(unknown("git identity unavailable"));

const temporaryRoot = await mkdtemp(join(tmpdir(), "open-pencil-proof-gap-132-"));
const archive = join(temporaryRoot, "source.tar");
const checkout = join(temporaryRoot, "checkout");

try {
  await Bun.write(checkout, "");
  await rm(checkout);
  await Bun.spawn(["mkdir", "-p", checkout]).exited;

  const archived = run(["git", "archive", "--format=tar", "-o", archive, commit], root);
  if (archived.exitCode !== 0) fail(unknown("git archive unavailable"));

  const extracted = run(["tar", "-xf", archive, "-C", checkout], root);
  if (extracted.exitCode !== 0) fail(unknown("source archive extraction unavailable"));

  await symlink(join(root, "node_modules"), join(checkout, "node_modules"), "dir");

  const baseline = run(["bun", "test", TEST_FILE], checkout);
  if (baseline.exitCode !== 0) {
    fail(unknown("baseline regression test failed", baseline.exitCode));
  }

  const sourcePath = join(checkout, SOURCE_FILE);
  const source = await readFile(sourcePath, "utf8");
  const occurrences = source.split(GUARD).length - 1;
  if (occurrences !== 1) {
    fail(unknown(`seed guard count ${occurrences}; expected 1`, baseline.exitCode));
  }
  await writeFile(sourcePath, source.replace(GUARD, SEEDED_GUARD));

  const seeded = run(["bun", "test", TEST_FILE], checkout);
  const outputContainsIdentity = seeded.output.includes(TEST_IDENTITY);
  const report: ProofReport = {
    proof: "PROOF-GAP-132",
    state: seeded.exitCode !== 0 && outputContainsIdentity ? "PROVED" : "UNKNOWN",
    commit,
    runtime: `bun-${Bun.version}`,
    testFile: TEST_FILE,
    testIdentity: TEST_IDENTITY,
    scenarios: 2,
    baselineExitCode: baseline.exitCode,
    seededDefectExitCode: seeded.exitCode,
    seededOutputContainsIdentity: outputContainsIdentity,
    consumingEffect: "UNKNOWN",
    ...(seeded.exitCode === 0
      ? { reason: "seeded missing-reference defect survived" }
      : !outputContainsIdentity
        ? { reason: "seeded failure did not identify the mapped regression test" }
        : {}),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.state !== "PROVED") process.exit(1);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

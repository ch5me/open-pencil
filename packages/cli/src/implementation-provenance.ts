import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_RUNTIME_PATHS = ["package.json", "src", "bin", "assets"] as const;

interface PackageJson {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface RuntimePackage {
  name: string;
  version: string;
  root: string;
  layout: "source" | "installed";
}

interface PathMeasurement {
  path: string;
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  nlink: bigint;
  kind: "file" | "directory" | "symlink";
}

interface ResolutionEdge {
  fromRoot: string;
  request: string;
  locator: PathMeasurement;
  resolvedRoot: string;
}

interface RuntimeTopology {
  packages: RuntimePackage[];
  edges: ResolutionEdge[];
}

interface PackageContent {
  root: string;
  occurrence: string;
  identity: string;
}

export interface ImplementationProvenanceSnapshot extends RuntimeTopology {
  digest: string;
  mode: "source" | "packed";
  entryRoot: string;
  repositoryRoot?: string;
  contents: PackageContent[];
  directories: PathMeasurement[];
  files: PathMeasurement[];
}

let activeSnapshot: ImplementationProvenanceSnapshot | undefined;

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function measurement(path: string, stats: BigIntStats): PathMeasurement {
  let kind: PathMeasurement["kind"];
  if (stats.isSymbolicLink()) kind = "symlink";
  else if (stats.isDirectory()) kind = "directory";
  else if (stats.isFile()) kind = "file";
  else throw new Error(`implementation provenance requires regular path: ${path}`);
  return {
    path,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    nlink: stats.nlink,
    kind,
  };
}

function sameMeasurement(first: PathMeasurement, second: PathMeasurement): boolean {
  return (
    first.path === second.path &&
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs &&
    first.nlink === second.nlink &&
    first.kind === second.kind
  );
}

async function files(
  path: string,
  dependencyRoot: string,
  directories: Map<string, PathMeasurement>,
): Promise<string[]> {
  const before = measurement(path, await lstat(path, { bigint: true }));
  if (before.kind === "symlink")
    throw new Error(`implementation provenance rejects symlink: ${path}`);
  if (before.kind === "file") return [path];
  const nested: string[] = [];
  for (const name of (await readdir(path)).sort()) {
    if (name === ".git") continue;
    const child = join(path, name);
    if (name === "node_modules") {
      if (child === dependencyRoot) continue;
      throw new Error(`implementation provenance rejects nested dependency root: ${child}`);
    }
    nested.push(...(await files(child, dependencyRoot, directories)));
  }
  const after = measurement(path, await lstat(path, { bigint: true }));
  if (!sameMeasurement(before, after)) {
    throw new Error(`implementation provenance input changed while traversing: ${path}`);
  }
  directories.set(path, after);
  return nested;
}

async function stableFile(path: string): Promise<{ bytes: Uint8Array; stat: PathMeasurement }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile())
      throw new Error(`implementation provenance requires regular file: ${path}`);
    if (before.nlink !== 1n)
      throw new Error(`implementation provenance rejects multiply linked file: ${path}`);
    const bytes = new Uint8Array(await handle.readFile());
    const after = await handle.stat({ bigint: true });
    const beforeMeasurement = measurement(path, before);
    const afterMeasurement = measurement(path, after);
    if (
      !sameMeasurement(beforeMeasurement, afterMeasurement) ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(`implementation provenance input changed while reading: ${path}`);
    }
    return { bytes, stat: afterMeasurement };
  } finally {
    await handle.close();
  }
}

async function readPackageJson(root: string): Promise<PackageJson> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
}

function dependencyNames(pkg: PackageJson): Array<{ name: string; optional: boolean }> {
  const required = new Set(Object.keys(pkg.dependencies ?? {}));
  const optional = new Set([
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  return [...new Set([...required, ...optional])]
    .sort()
    .map((name) => ({ name, optional: !required.has(name) }));
}

async function sourcePackages(repositoryRoot: string): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  for (const entry of await readdir(join(repositoryRoot, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(repositoryRoot, "packages", entry.name);
    if (!(await pathExists(join(root, "package.json")))) continue;
    roots.set((await readPackageJson(root)).name, await realpath(root));
  }
  return roots;
}

async function resolveDependency(
  request: string,
  fromRoot: string,
): Promise<ResolutionEdge | null> {
  let current = fromRoot;
  while (dirname(current) !== current) {
    const locator = join(current, "node_modules", ...request.split("/"));
    if (await pathExists(join(locator, "package.json"))) {
      const before = measurement(locator, await lstat(locator, { bigint: true }));
      const resolvedRoot = await realpath(locator);
      const after = measurement(locator, await lstat(locator, { bigint: true }));
      if (!sameMeasurement(before, after)) {
        throw new Error(`implementation provenance dependency changed while resolving: ${locator}`);
      }
      return { fromRoot, request, locator: after, resolvedRoot };
    }
    current = dirname(current);
  }
  return null;
}

async function runtimeTopology(
  cliRoot: string,
  localPackages?: Map<string, string>,
): Promise<RuntimeTopology> {
  const selected = new Map<string, RuntimePackage>();
  const edges: ResolutionEdge[] = [];
  const pending: Array<{ root: string; layout: RuntimePackage["layout"] }> = [
    { root: cliRoot, layout: localPackages ? "source" : "installed" },
  ];

  while (pending.length > 0) {
    const current = pending.shift() as { root: string; layout: RuntimePackage["layout"] };
    const resolvedRoot = await realpath(current.root);
    if (selected.has(resolvedRoot)) continue;
    const pkg = await readPackageJson(resolvedRoot);
    selected.set(resolvedRoot, {
      name: pkg.name,
      version: pkg.version ?? "unknown",
      root: resolvedRoot,
      layout: current.layout,
    });

    for (const dependency of dependencyNames(pkg)) {
      const edge = await resolveDependency(dependency.name, resolvedRoot);
      if (!edge) {
        if (dependency.optional) continue;
        throw new Error(
          `implementation provenance cannot resolve production dependency ${dependency.name} from ${pkg.name}`,
        );
      }
      const localRoot = localPackages?.get(dependency.name);
      if (localRoot && edge.resolvedRoot !== localRoot) {
        throw new Error(
          `implementation provenance source dependency ${dependency.name} resolves outside selected workspace package`,
        );
      }
      edges.push(edge);
      pending.push({
        root: edge.resolvedRoot,
        layout: localRoot ? "source" : "installed",
      });
    }
  }

  return {
    packages: [...selected.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.version.localeCompare(b.version) ||
        a.root.localeCompare(b.root),
    ),
    edges: edges.sort(
      (a, b) =>
        a.fromRoot.localeCompare(b.fromRoot) ||
        a.request.localeCompare(b.request) ||
        a.locator.path.localeCompare(b.locator.path),
    ),
  };
}

async function assertCleanSource(
  repositoryRoot: string,
  packages: RuntimePackage[],
): Promise<void> {
  const paths = packages
    .filter((pkg) => pkg.layout === "source")
    .map((pkg) => relative(repositoryRoot, pkg.root));
  const status = Bun.spawnSync(
    ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", ...paths],
    {
      cwd: repositoryRoot,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (!status.success) {
    throw new Error(
      `implementation provenance could not verify source state: ${status.stderr.toString().trim()}`,
    );
  }
  if (status.stdout.byteLength > 0) {
    throw new Error("CH5 review receipt requires clean source implementation bytes");
  }
}

async function measure(
  mode: "source" | "packed",
  entryRoot: string,
  topology: RuntimeTopology,
  repositoryRoot?: string,
): Promise<ImplementationProvenanceSnapshot> {
  if (mode === "source") await assertCleanSource(repositoryRoot as string, topology.packages);
  const measuredFiles: PathMeasurement[] = [];
  const measuredDirectories = new Map<string, PathMeasurement>();
  const contents: PackageContent[] = [];

  for (const pkg of topology.packages) {
    const dependencyRoot = join(pkg.root, "node_modules");
    const rootBefore = measurement(pkg.root, await lstat(pkg.root, { bigint: true }));
    if (rootBefore.kind !== "directory")
      throw new Error(`implementation provenance requires package directory: ${pkg.root}`);
    measuredDirectories.set(pkg.root, rootBefore);

    const selected: string[] = [];
    if (pkg.layout === "source") {
      for (const runtimePath of SOURCE_RUNTIME_PATHS) {
        const candidate = join(pkg.root, runtimePath);
        if (await pathExists(candidate)) {
          selected.push(...(await files(candidate, dependencyRoot, measuredDirectories)));
        }
      }
    } else {
      selected.push(...(await files(pkg.root, dependencyRoot, measuredDirectories)));
    }
    selected.sort(
      (a, b) => relative(pkg.root, a).localeCompare(relative(pkg.root, b)) || a.localeCompare(b),
    );

    const packageHash = createHash("sha256").update("open-pencil package content v1\0");
    for (const path of selected) {
      const name = `${pkg.name}@${pkg.version}/${relative(pkg.root, path).replaceAll("\\", "/")}`;
      const { bytes, stat } = await stableFile(path);
      packageHash.update(String(name.length)).update("\0").update(name);
      packageHash.update(String(bytes.byteLength)).update("\0").update(bytes);
      measuredFiles.push(stat);
    }
    contents.push({
      root: pkg.root,
      occurrence: relative(entryRoot, pkg.root).replaceAll("\\", "/") || ".",
      identity: `sha256:${packageHash.digest("hex")}`,
    });
  }

  const directories = [...measuredDirectories.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  for (const directory of directories) {
    const after = measurement(directory.path, await lstat(directory.path, { bigint: true }));
    if (!sameMeasurement(directory, after)) {
      throw new Error(`implementation provenance input changed while measuring: ${directory.path}`);
    }
  }
  measuredFiles.sort((a, b) => a.path.localeCompare(b.path));
  contents.sort(
    (a, b) =>
      a.occurrence.localeCompare(b.occurrence) ||
      a.identity.localeCompare(b.identity) ||
      a.root.localeCompare(b.root),
  );

  const identities = new Map(contents.map((content) => [content.root, content]));
  const entryIdentity = identities.get(entryRoot);
  if (!entryIdentity) throw new Error("implementation provenance cannot identify entry package");
  const edgeIdentities = topology.edges
    .map((edge) => {
      const source = identities.get(edge.fromRoot);
      const target = identities.get(edge.resolvedRoot);
      if (!source || !target)
        throw new Error("implementation provenance cannot identify dependency edge package");
      return JSON.stringify([
        source.occurrence,
        source.identity,
        edge.request,
        target.occurrence,
        target.identity,
      ]);
    })
    .sort();
  const hash = createHash("sha256").update("open-pencil implementation provenance v2\0");
  hash.update(JSON.stringify([entryIdentity.occurrence, entryIdentity.identity])).update("\0");
  for (const content of contents) {
    hash.update(JSON.stringify([content.occurrence, content.identity])).update("\0");
  }
  for (const edge of edgeIdentities) hash.update(edge).update("\0");

  return {
    digest: `sha256:${hash.digest("hex")}`,
    mode,
    entryRoot,
    ...(repositoryRoot ? { repositoryRoot } : {}),
    ...topology,
    contents,
    directories,
    files: measuredFiles,
  };
}

function sameTopology(first: RuntimeTopology, second: RuntimeTopology): boolean {
  if (
    first.packages.length !== second.packages.length ||
    first.edges.length !== second.edges.length
  )
    return false;
  for (let index = 0; index < first.packages.length; index += 1) {
    const a = first.packages[index];
    const b = second.packages[index];
    if (
      a.name !== b.name ||
      a.version !== b.version ||
      a.root !== b.root ||
      a.layout !== b.layout
    ) {
      return false;
    }
  }
  for (let index = 0; index < first.edges.length; index += 1) {
    const a = first.edges[index];
    const b = second.edges[index];
    if (
      a.fromRoot !== b.fromRoot ||
      a.request !== b.request ||
      a.resolvedRoot !== b.resolvedRoot ||
      !sameMeasurement(a.locator, b.locator)
    ) {
      return false;
    }
  }
  return true;
}

export async function captureImplementationProvenance(
  sourceRoot?: string,
): Promise<ImplementationProvenanceSnapshot> {
  if (sourceRoot || import.meta.url.endsWith(".ts")) {
    const repositoryRoot = await realpath(
      sourceRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
    );
    const localPackages = await sourcePackages(repositoryRoot);
    const cliRoot = localPackages.get("@open-pencil/cli");
    if (!cliRoot) throw new Error("implementation provenance cannot resolve source CLI package");
    return measure(
      "source",
      cliRoot,
      await runtimeTopology(cliRoot, localPackages),
      repositoryRoot,
    );
  }
  const cliRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  return measure("packed", cliRoot, await runtimeTopology(cliRoot));
}

export async function verifyImplementationProvenance(
  before: ImplementationProvenanceSnapshot,
): Promise<string> {
  const localPackages = before.repositoryRoot
    ? await sourcePackages(before.repositoryRoot)
    : undefined;
  const topology = await runtimeTopology(before.entryRoot, localPackages);
  if (!sameTopology(before, topology)) {
    throw new Error(
      "implementation provenance dependency resolution changed during lint execution",
    );
  }
  const after = await measure(before.mode, before.entryRoot, topology, before.repositoryRoot);
  if (
    after.digest !== before.digest ||
    after.directories.length !== before.directories.length ||
    after.files.length !== before.files.length
  ) {
    throw new Error("implementation provenance changed during lint execution");
  }
  for (let index = 0; index < before.directories.length; index += 1) {
    if (!sameMeasurement(before.directories[index], after.directories[index])) {
      throw new Error("implementation provenance changed during lint execution");
    }
  }
  for (let index = 0; index < before.files.length; index += 1) {
    if (!sameMeasurement(before.files[index], after.files[index])) {
      throw new Error("implementation provenance changed during lint execution");
    }
  }
  return before.digest;
}

export async function prepareImplementationProvenance(argv: readonly string[]): Promise<void> {
  const contextIndex = argv.findIndex(
    (arg) => arg === "--ch5-review-context" || arg.startsWith("--ch5-review-context="),
  );
  if (contextIndex < 0) return;
  const contextArg = argv[contextIndex];
  const contextPath =
    contextArg.startsWith("--ch5-review-context=") &&
    contextArg.length > "--ch5-review-context=".length
      ? contextArg.slice("--ch5-review-context=".length)
      : argv[contextIndex + 1];
  if (!contextPath) throw new Error("--ch5-review-context requires a context path");
  // Reject malformed review context before the expensive provenance walk.
  const { readCh5ReviewContext } = await import("./ch5-review-receipt");
  await readCh5ReviewContext(contextPath);
  activeSnapshot = await captureImplementationProvenance();
}

export async function finalizeImplementationProvenance(): Promise<string> {
  if (!activeSnapshot) {
    throw new Error(
      "CH5 review receipt implementation provenance was not captured before execution",
    );
  }
  const snapshot = activeSnapshot;
  activeSnapshot = undefined;
  return verifyImplementationProvenance(snapshot);
}

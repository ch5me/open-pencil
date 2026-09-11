import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

type SyncClassification = 'up-to-date' | 'routine' | 'review' | 'program'

interface SyncConfig {
  schema: 'ch5.upstream-sync.config.v1'
  upstream: { remote: string; url: string; branch: string }
  target: { remote: string; branch: string }
  thresholds: {
    maxUpstreamCommits: number
    maxChangedFiles: number
    maxConflicts: number
  }
  criticalPaths: string[]
  verification: { commands: string[] }
  commit: { messagePrefix: string }
  lockFile: string
  requireManagedWorktree: boolean
  replay?: {
    additivePaths: string[]
    stateFile: string
  }
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface SyncReport {
  schema: 'ch5.upstream-sync.report.v1'
  generatedAt: string
  repository: string
  classification: SyncClassification
  canAutomate: boolean
  reasons: string[]
  refs: {
    head: string
    target: string
    upstream: string
    mergeBase: string
  }
  counts: {
    upstreamCommits: number
    forkCommits: number
    upstreamChangedFiles: number
    conflicts: number
    criticalFiles: number
  }
  changedTopLevels: Record<string, number>
  criticalFiles: string[]
  conflictLines: string[]
  conflictLinesTruncated: boolean
}

interface ReplayReport {
  schema: 'ch5.upstream-replay.report.v1'
  generatedAt: string
  repository: string
  refs: SyncReport['refs']
  counts: {
    additiveFiles: number
    forkAddedFiles: number
    forkDeletedFiles: number
    forkModifiedFiles: number
  }
  additivePaths: string[]
  additiveFiles: string[]
}

interface ReplayCheckpointReport {
  schema: 'ch5.upstream-replay.checkpoint.v1'
  generatedAt: string
  repository: string
  ref: string
  commit: string
  tree: string
  /** Exact parents the eventual `finish` merge must use. Recorded as metadata
   *  only: the checkpoint commit itself is deliberately single-parent. */
  intendedMergeParents: { privateHead: string; upstream: string }
  additivePaths: string[]
  unresolvedPaths: string[]
}

const CONFIG_PATH = '.ch5/upstream-sync.json'

function run(command: string[], cwd: string, allowFailure = false): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, LC_ALL: 'C' },
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const output = {
    code: result.exitCode,
    stderr: result.stderr.toString().trim(),
    stdout: result.stdout.toString().trim()
  }
  if (!allowFailure && output.code !== 0) {
    throw new Error(
      [`Command failed (${output.code}): ${command.join(' ')}`, output.stderr, output.stdout]
        .filter(Boolean)
        .join('\n')
    )
  }
  return output
}

function git(args: string[], cwd: string, allowFailure = false): CommandResult {
  return run(['git', ...args], cwd, allowFailure)
}

function repoRoot(cwd = process.cwd()): string {
  return git(['rev-parse', '--show-toplevel'], cwd).stdout
}

function loadConfig(root: string): SyncConfig {
  const path = resolve(root, CONFIG_PATH)
  const config = JSON.parse(readFileSync(path, 'utf8')) as SyncConfig
  if (config.schema !== 'ch5.upstream-sync.config.v1') {
    throw new Error(`Unsupported upstream sync config: ${config.schema}`)
  }
  return config
}

function requireManagedWorktree(root: string, config: SyncConfig): void {
  if (!config.requireManagedWorktree) return
  const gitDir = git(['rev-parse', '--git-dir'], root).stdout
  const commonDir = git(['rev-parse', '--git-common-dir'], root).stdout
  if (resolve(root, gitDir) === resolve(root, commonDir)) {
    throw new Error('UPSTREAM_SYNC_MANAGED_WORKTREE_REQUIRED: bind a Grove Tree before syncing')
  }
}

function requireClean(root: string): void {
  const status = git(['status', '--porcelain=v1', '-uall'], root).stdout
  if (status) throw new Error(`UPSTREAM_SYNC_DIRTY_WORKTREE:\n${status}`)
}

function ensureUpstream(root: string, config: SyncConfig): void {
  const remote = git(['remote', 'get-url', config.upstream.remote], root, true)
  if (remote.code !== 0) {
    git(['remote', 'add', config.upstream.remote, config.upstream.url], root)
  } else if (remote.stdout !== config.upstream.url) {
    git(['remote', 'set-url', config.upstream.remote, config.upstream.url], root)
  }
  git(
    ['remote', 'set-url', '--push', config.upstream.remote, 'DISABLED-no-upstream-contributions'],
    root
  )
}

function fetchRefs(root: string, config: SyncConfig): void {
  ensureUpstream(root, config)
  git(['fetch', '--prune', config.target.remote, config.target.branch], root)
  git(['fetch', '--prune', config.upstream.remote, config.upstream.branch], root)
}

function countTopLevels(files: string[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const top = file.split('/', 1)[0] ?? file
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]))
}

function matchesCriticalPath(file: string, criticalPath: string): boolean {
  return criticalPath.endsWith('/') ? file.startsWith(criticalPath) : file === criticalPath
}

function inspect(root: string, config: SyncConfig, fetch = true): SyncReport {
  if (fetch) fetchRefs(root, config)
  const upstreamRef = `${config.upstream.remote}/${config.upstream.branch}`
  const targetRef = `${config.target.remote}/${config.target.branch}`
  const head = git(['rev-parse', 'HEAD'], root).stdout
  const target = git(['rev-parse', targetRef], root).stdout
  const upstream = git(['rev-parse', upstreamRef], root).stdout
  const mergeBase = git(['merge-base', 'HEAD', upstreamRef], root).stdout
  const [upstreamCommits = 0, forkCommits = 0] = git(
    ['rev-list', '--left-right', '--count', `${upstreamRef}...HEAD`],
    root
  )
    .stdout.split(/\s+/)
    .map(Number)
  const changedFiles = git(['diff', '--name-only', `${mergeBase}..${upstreamRef}`], root)
    .stdout.split('\n')
    .filter(Boolean)
  const mergeTree = git(['merge-tree', '--write-tree', 'HEAD', upstreamRef], root, true)
  const allConflictLines = mergeTree.stdout
    .split('\n')
    .filter((line) => line.startsWith('CONFLICT '))
  const conflictLines = allConflictLines.slice(0, 100)
  const criticalFiles = changedFiles.filter((file) =>
    config.criticalPaths.some((criticalPath) => matchesCriticalPath(file, criticalPath))
  )
  const reasons: string[] = []
  let classification: SyncClassification = 'routine'
  if (upstreamCommits === 0) {
    classification = 'up-to-date'
    reasons.push('No upstream commits are pending')
  } else {
    if (upstreamCommits > config.thresholds.maxUpstreamCommits) {
      reasons.push(
        `${upstreamCommits} upstream commits exceed ${config.thresholds.maxUpstreamCommits}`
      )
    }
    if (changedFiles.length > config.thresholds.maxChangedFiles) {
      reasons.push(
        `${changedFiles.length} changed files exceed ${config.thresholds.maxChangedFiles}`
      )
    }
    if (allConflictLines.length > config.thresholds.maxConflicts) {
      reasons.push(`${allConflictLines.length} conflicts exceed ${config.thresholds.maxConflicts}`)
    }
    if (reasons.length > 0) {
      classification = 'program'
    } else if (criticalFiles.length > 0) {
      classification = 'review'
      reasons.push(`${criticalFiles.length} critical-path files require focused review`)
    } else {
      reasons.push('Merge is conflict-free and within configured drift thresholds')
    }
  }
  return {
    canAutomate: classification === 'routine' || classification === 'review',
    changedTopLevels: countTopLevels(changedFiles),
    classification,
    conflictLines,
    conflictLinesTruncated: allConflictLines.length > conflictLines.length,
    counts: {
      conflicts: allConflictLines.length,
      criticalFiles: criticalFiles.length,
      forkCommits,
      upstreamChangedFiles: changedFiles.length,
      upstreamCommits
    },
    criticalFiles,
    generatedAt: new Date().toISOString(),
    reasons,
    refs: { head, mergeBase, target, upstream },
    repository: root,
    schema: 'ch5.upstream-sync.report.v1'
  }
}

function printReport(report: SyncReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`classification: ${report.classification}`)
  console.log(`upstream: ${report.counts.upstreamCommits} commit(s), ${report.refs.upstream}`)
  console.log(`fork: ${report.counts.forkCommits} commit(s), ${report.refs.head}`)
  console.log(
    `surface: ${report.counts.upstreamChangedFiles} changed file(s), ${report.counts.conflicts} conflict(s)`
  )
  for (const reason of report.reasons) console.log(`- ${reason}`)
}

function pathMatches(file: string, configuredPath: string): boolean {
  return configuredPath.endsWith('/')
    ? file.startsWith(configuredPath)
    : file === configuredPath || file.startsWith(`${configuredPath}/`)
}

function replayPlan(root: string, config: SyncConfig, fetch = true): ReplayReport {
  if (!config.replay) throw new Error('UPSTREAM_REPLAY_CONFIG_REQUIRED')
  const sync = inspect(root, config, fetch)
  const forkDelta = git(
    ['diff', '--name-status', `${sync.refs.upstream}...${sync.refs.head}`],
    root
  )
    .stdout.split('\n')
    .filter(Boolean)
  const forkFiles = forkDelta.map((line) => line.split('\t').at(-1) ?? '').filter(Boolean)
  const additiveFiles = forkFiles.filter((file) =>
    config.replay?.additivePaths.some((path) => pathMatches(file, path))
  )
  const countStatus = (status: string) =>
    forkDelta.filter((line) => line.startsWith(`${status}\t`)).length
  return {
    additiveFiles,
    additivePaths: config.replay.additivePaths,
    counts: {
      additiveFiles: additiveFiles.length,
      forkAddedFiles: countStatus('A'),
      forkDeletedFiles: countStatus('D'),
      forkModifiedFiles: forkDelta.length - countStatus('A') - countStatus('D')
    },
    generatedAt: new Date().toISOString(),
    refs: sync.refs,
    repository: root,
    schema: 'ch5.upstream-replay.report.v1'
  }
}

function printReplayReport(report: ReplayReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`upstream-first replay: ${report.refs.upstream}`)
  console.log(`private base: ${report.refs.head}`)
  console.log(
    `fork delta: ${report.counts.forkAddedFiles} added, ${report.counts.forkModifiedFiles} modified, ${report.counts.forkDeletedFiles} deleted`
  )
  console.log(`additive seed: ${report.counts.additiveFiles} file(s)`)
}

function writeJSON(path: string, value: unknown): void {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function runVerification(root: string, config: SyncConfig): void {
  for (const command of config.verification.commands) {
    console.log(`\n==> ${command}`)
    const result = run(['sh', '-lc', command], root, true)
    if (result.stdout) console.log(result.stdout)
    if (result.stderr) console.error(result.stderr)
    if (result.code !== 0) throw new Error(`UPSTREAM_SYNC_VERIFICATION_FAILED: ${command}`)
  }
}

function mergeInProgress(root: string): boolean {
  const gitPath = git(['rev-parse', '--git-path', 'MERGE_HEAD'], root).stdout
  return existsSync(isAbsolute(gitPath) ? gitPath : resolve(root, gitPath))
}

function startMerge(root: string, config: SyncConfig, allowProgram: boolean): SyncReport {
  requireManagedWorktree(root, config)
  const report = inspect(root, config)
  if (report.classification === 'up-to-date') return report
  if (report.classification === 'program' && !allowProgram) {
    throw new Error(
      `UPSTREAM_SYNC_PROGRAM_REQUIRED: ${report.reasons.join('; ')}. Review the report before using --allow-program.`
    )
  }
  requireClean(root)
  const upstreamRef = `${config.upstream.remote}/${config.upstream.branch}`
  const result = git(['merge', '--no-ff', '--no-commit', upstreamRef], root, true)
  if (result.code !== 0) {
    throw new Error(
      'UPSTREAM_SYNC_CONFLICTS_PRESENT: merge state preserved for intent-aware resolution'
    )
  }
  return report
}

function startReplay(
  workspace: string,
  config: SyncConfig,
  allowProgram: boolean,
  confirmUpstreamFirst: boolean
): ReplayReport {
  if (!config.replay) throw new Error('UPSTREAM_REPLAY_CONFIG_REQUIRED')
  if (!allowProgram || !confirmUpstreamFirst) {
    throw new Error(
      'UPSTREAM_REPLAY_CONFIRMATION_REQUIRED: pass --allow-program --confirm-upstream-first'
    )
  }
  requireManagedWorktree(workspace, config)
  requireClean(workspace)
  const report = replayPlan(workspace, config)
  const privateHead = git(['rev-parse', 'HEAD'], workspace).stdout
  const merge = git(['merge', '--no-ff', '--no-commit', report.refs.upstream], workspace, true)
  if (!mergeInProgress(workspace)) {
    throw new Error(
      `UPSTREAM_REPLAY_MERGE_STATE_MISSING: merge exited ${merge.code} without MERGE_HEAD`
    )
  }

  // The replay candidate deliberately starts from upstream's complete tree.
  git(['read-tree', '--reset', '-u', report.refs.upstream], workspace)
  for (const path of config.replay.additivePaths) {
    const existsAtPrivateHead = git(['cat-file', '-e', `${privateHead}:${path}`], workspace, true)
    if (existsAtPrivateHead.code === 0) git(['checkout', privateHead, '--', path], workspace)
  }

  writeJSON(resolve(workspace, config.replay.stateFile), {
    schema: 'ch5.upstream-replay.state.v1',
    additivePaths: config.replay.additivePaths,
    privateHead,
    startedAt: new Date().toISOString(),
    upstream: report.refs.upstream
  })
  git(['add', '-A'], workspace)
  return report
}

// Preserves an in-progress replay candidate for review WITHOUT landing it.
// The checkpoint commit is deliberately single-parent (privateHead only) so it
// can never be mistaken for, or substituted for, the real two-parent merge that
// `finish` must produce. Merge state, HEAD, the index and the worktree are all
// left untouched, and nothing is ever pushed.
function checkpointReplay(root: string, config: SyncConfig): ReplayCheckpointReport {
  if (!config.replay) throw new Error('UPSTREAM_REPLAY_CONFIG_REQUIRED')
  requireManagedWorktree(root, config)
  if (!mergeInProgress(root)) {
    throw new Error('UPSTREAM_REPLAY_CHECKPOINT_NO_MERGE: no replay candidate in progress')
  }
  const unresolved = git(['diff', '--name-only', '--diff-filter=U'], root).stdout
  if (unresolved) {
    throw new Error(`UPSTREAM_REPLAY_CHECKPOINT_UNRESOLVED:\n${unresolved}`)
  }
  const statePath = resolve(root, config.replay.stateFile)
  if (!existsSync(statePath)) {
    throw new Error('UPSTREAM_REPLAY_CHECKPOINT_STATE_MISSING: replay-start has not run here')
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
    privateHead: string
    upstream: string
  }
  const mergeHead = git(['rev-parse', 'MERGE_HEAD'], root).stdout
  if (mergeHead !== state.upstream) {
    throw new Error(
      `UPSTREAM_REPLAY_CHECKPOINT_PARENT_MISMATCH: MERGE_HEAD ${mergeHead} != state ${state.upstream}`
    )
  }
  const tree = git(['write-tree'], root).stdout
  const message = [
    'chore(upstream): replay candidate checkpoint',
    '',
    'Reviewable snapshot of an in-progress upstream-first replay.',
    'NOT the integration merge: this commit is single-parent by design.',
    `intended-merge-parent-1: ${state.privateHead}`,
    `intended-merge-parent-2: ${state.upstream}`
  ].join('\n')
  const commit = git(['commit-tree', tree, '-p', state.privateHead, '-m', message], root).stdout
  const ref = `refs/ch5/upstream-replay-checkpoint/${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, 'Z')}`
  git(['update-ref', ref, commit], root)
  return {
    schema: 'ch5.upstream-replay.checkpoint.v1',
    generatedAt: new Date().toISOString(),
    repository: root,
    ref,
    commit,
    tree,
    intendedMergeParents: { privateHead: state.privateHead, upstream: state.upstream },
    additivePaths: config.replay.additivePaths,
    unresolvedPaths: []
  }
}

function finishMerge(root: string, config: SyncConfig, push: boolean): void {
  requireManagedWorktree(root, config)
  if (!mergeInProgress(root)) throw new Error('UPSTREAM_SYNC_MERGE_NOT_IN_PROGRESS')
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], root).stdout
  if (unmerged) throw new Error(`UPSTREAM_SYNC_UNRESOLVED_CONFLICTS:\n${unmerged}`)
  runVerification(root, config)
  const upstreamSha = git(['rev-parse', 'MERGE_HEAD'], root).stdout
  const lock = {
    schema: 'ch5.upstream-sync.lock.v1',
    integratedAt: new Date().toISOString(),
    mergeBase: git(['merge-base', 'HEAD', upstreamSha], root).stdout,
    upstream: {
      branch: config.upstream.branch,
      remote: config.upstream.remote,
      sha: upstreamSha,
      url: config.upstream.url
    },
    verification: config.verification.commands
  }
  writeJSON(resolve(root, config.lockFile), lock)
  git(['add', config.lockFile], root)
  const label =
    git(['describe', '--tags', '--exact-match', lock.upstream.sha], root, true).stdout ||
    lock.upstream.sha.slice(0, 12)
  git(['commit', '-m', `${config.commit.messagePrefix} ${label}`], root)
  if (!push) return
  const wanted = git(['rev-parse', 'HEAD'], root).stdout
  git(['push', config.target.remote, `HEAD:${config.target.branch}`], root)
  git(['fetch', config.target.remote, config.target.branch], root)
  const landed = git(
    ['merge-base', '--is-ancestor', wanted, `${config.target.remote}/${config.target.branch}`],
    root,
    true
  )
  if (landed.code !== 0) throw new Error('UPSTREAM_SYNC_PUSH_NOT_PROVEN')
}

function parseOptions(args: string[]): {
  allowProgram: boolean
  confirmUpstreamFirst: boolean
  json: boolean
  push: boolean
  report?: string
} {
  const reportIndex = args.indexOf('--report')
  return {
    allowProgram: args.includes('--allow-program'),
    confirmUpstreamFirst: args.includes('--confirm-upstream-first'),
    json: args.includes('--json'),
    push: args.includes('--push'),
    report: reportIndex !== -1 ? args[reportIndex + 1] : undefined
  }
}

function main(): void {
  const [command = 'inspect', ...args] = process.argv.slice(2)
  const options = parseOptions(args)
  const root = repoRoot()
  const config = loadConfig(root)
  if (command === 'inspect') {
    const report = inspect(root, config)
    if (options.report) writeJSON(options.report, report)
    printReport(report, options.json)
    return
  }
  if (command === 'merge') {
    const report = startMerge(root, config, options.allowProgram)
    if (options.report) writeJSON(options.report, report)
    printReport(report, options.json)
    return
  }
  if (command === 'replay-plan') {
    const report = replayPlan(root, config)
    if (options.report) writeJSON(options.report, report)
    printReplayReport(report, options.json)
    return
  }
  if (command === 'replay-start') {
    const report = startReplay(root, config, options.allowProgram, options.confirmUpstreamFirst)
    if (options.report) writeJSON(options.report, report)
    printReplayReport(report, options.json)
    return
  }
  if (command === 'replay-checkpoint') {
    const report = checkpointReplay(root, config)
    if (options.report) writeJSON(options.report, report)
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(`checkpoint ref:    ${report.ref}`)
      console.log(`checkpoint commit: ${report.commit}`)
      console.log(`candidate tree:    ${report.tree}`)
      console.log(
        `intended parents:  ${report.intendedMergeParents.privateHead} + ${report.intendedMergeParents.upstream}`
      )
    }
    return
  }
  if (command === 'verify') {
    runVerification(root, config)
    return
  }
  if (command === 'finish') {
    finishMerge(root, config, options.push)
    return
  }
  if (command === 'sync') {
    const report = startMerge(root, config, options.allowProgram)
    if (options.report) writeJSON(options.report, report)
    printReport(report, options.json)
    if (report.classification !== 'up-to-date') finishMerge(root, config, options.push)
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

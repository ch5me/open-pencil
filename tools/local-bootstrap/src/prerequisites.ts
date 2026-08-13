import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const MARKER_NAME = '.open-pencil-bootstrap'

export interface CommandRunner {
  run(command: string, args: string[], cwd: string): Promise<void>
}

interface Prerequisite {
  label: string
  inputs: string[]
  outputs: string[]
  marker: string
  command: string
  args: string[]
  cwd: string
}

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await filesBelow(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function fingerprint(root: string, inputs: string[]): Promise<string> {
  const paths: string[] = []
  for (const input of inputs) {
    const details = await stat(input)
    paths.push(...(details.isDirectory() ? await filesBelow(input) : [input]))
  }

  const hash = createHash('sha256')
  for (const path of paths.sort()) {
    hash.update(relative(root, path))
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function isCurrent(
  root: string,
  prerequisite: Prerequisite,
  expected: string
): Promise<boolean> {
  try {
    await Promise.all(prerequisite.outputs.map((output) => stat(output)))
    return (await readFile(prerequisite.marker, 'utf8')).trim() === expected
  } catch {
    return false
  }
}

async function ensure(
  root: string,
  prerequisite: Prerequisite,
  runner: CommandRunner
): Promise<boolean> {
  const expected = await fingerprint(root, prerequisite.inputs)
  if (await isCurrent(root, prerequisite, expected)) return false

  process.stdout.write(`local-bootstrap: ensuring ${prerequisite.label}\n`)
  try {
    await runner.run(prerequisite.command, prerequisite.args, prerequisite.cwd)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`local-bootstrap: failed to ensure ${prerequisite.label}: ${detail}`)
  }

  for (const output of prerequisite.outputs) {
    try {
      await stat(output)
    } catch {
      throw new Error(
        `local-bootstrap: failed to ensure ${prerequisite.label}: command succeeded but ${relative(root, output)} is missing`
      )
    }
  }
  await mkdir(dirname(prerequisite.marker), { recursive: true })
  await writeFile(prerequisite.marker, `${expected}\n`)
  return true
}

export async function ensurePrerequisites(root: string, runner: CommandRunner): Promise<boolean[]> {
  const apiRoot = join(root, 'api')
  const contractsRoot = join(root, 'packages/agent-contracts')
  const prerequisites: Prerequisite[] = [
    {
      label: 'standalone API dependencies',
      inputs: [join(apiRoot, 'package.json'), join(apiRoot, 'bun.lock')],
      outputs: [join(apiRoot, 'node_modules/@ch5me/elf-auth-client/package.json')],
      marker: join(apiRoot, 'node_modules', MARKER_NAME),
      command: 'hush',
      args: [
        'run',
        '--target',
        'dependency-install',
        '--',
        'bun',
        'install',
        '--cwd',
        'api',
        '--frozen-lockfile'
      ],
      cwd: root
    },
    {
      label: '@open-pencil/agent-contracts build',
      inputs: [
        join(contractsRoot, 'package.json'),
        join(contractsRoot, 'tsdown.config.ts'),
        join(contractsRoot, 'src')
      ],
      outputs: [join(contractsRoot, 'dist/index.js'), join(contractsRoot, 'dist/index.d.ts')],
      marker: join(contractsRoot, 'dist', MARKER_NAME),
      command: 'bun',
      args: ['--filter', '@open-pencil/agent-contracts', 'build'],
      cwd: root
    }
  ]

  const results: boolean[] = []
  for (const prerequisite of prerequisites) results.push(await ensure(root, prerequisite, runner))
  return results
}

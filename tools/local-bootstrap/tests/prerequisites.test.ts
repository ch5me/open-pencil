import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensurePrerequisites, type CommandRunner } from '../src/prerequisites'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-pencil-bootstrap-'))
  roots.push(root)
  await mkdir(join(root, 'api'), { recursive: true })
  await mkdir(join(root, 'packages/agent-contracts/src'), { recursive: true })
  await writeFile(join(root, 'api/package.json'), '{}')
  await writeFile(join(root, 'api/bun.lock'), 'lock')
  await writeFile(join(root, 'packages/agent-contracts/package.json'), '{}')
  await writeFile(join(root, 'packages/agent-contracts/tsdown.config.ts'), 'export default {}')
  await writeFile(join(root, 'packages/agent-contracts/src/index.ts'), 'export const contract = 1')
  return root
}

function successfulRunner(root: string, calls: string[]): CommandRunner {
  return {
    async run(command, args) {
      calls.push([command, ...args].join(' '))
      if (command === 'hush') {
        await mkdir(join(root, 'api/node_modules/@ch5me/elf-auth-client'), { recursive: true })
        await writeFile(join(root, 'api/node_modules/@ch5me/elf-auth-client/package.json'), '{}')
      } else {
        await mkdir(join(root, 'packages/agent-contracts/dist'), { recursive: true })
        await writeFile(join(root, 'packages/agent-contracts/dist/index.js'), 'export {}')
        await writeFile(join(root, 'packages/agent-contracts/dist/index.d.ts'), 'export {}')
      }
    }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local service prerequisites', () => {
  test('installs and builds missing prerequisites through the authorized commands', async () => {
    const root = await fixture()
    const calls: string[] = []

    expect(await ensurePrerequisites(root, successfulRunner(root, calls))).toEqual([true, true])
    expect(calls).toEqual([
      'hush run --target dependency-install -- bun install --cwd api --frozen-lockfile',
      'bun --filter @open-pencil/agent-contracts build'
    ])
  })

  test('does no work when prerequisite fingerprints and outputs are current', async () => {
    const root = await fixture()
    const calls: string[] = []
    const runner = successfulRunner(root, calls)
    await ensurePrerequisites(root, runner)
    calls.length = 0

    expect(await ensurePrerequisites(root, runner)).toEqual([false, false])
    expect(calls).toEqual([])
  })

  test('refreshes only a stale prerequisite', async () => {
    const root = await fixture()
    const calls: string[] = []
    const runner = successfulRunner(root, calls)
    await ensurePrerequisites(root, runner)
    calls.length = 0
    await writeFile(
      join(root, 'packages/agent-contracts/src/index.ts'),
      'export const contract = 2'
    )

    expect(await ensurePrerequisites(root, runner)).toEqual([false, true])
    expect(calls).toEqual(['bun --filter @open-pencil/agent-contracts build'])
  })

  test('reports the failed prerequisite without exposing command environment', async () => {
    const root = await fixture()
    const runner: CommandRunner = {
      async run() {
        throw new Error('exited with status 9')
      }
    }

    await expect(ensurePrerequisites(root, runner)).rejects.toThrow(
      'local-bootstrap: failed to ensure standalone API dependencies: exited with status 9'
    )
    expect(await readFile(join(root, 'api/package.json'), 'utf8')).toBe('{}')
  })
})

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensurePrerequisites, type CommandRunner } from './prerequisites'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const lock = join(root, 'node_modules/.cache/open-pencil-local-bootstrap.lock')

const runner: CommandRunner = {
  run(command, args, cwd) {
    return new Promise((resolveCommand, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) resolveCommand()
        else reject(new Error(`${command} exited with status ${code ?? 'unknown'}`))
      })
    })
  }
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function acquireLock(): Promise<void> {
  await mkdir(join(root, 'node_modules/.cache'), { recursive: true })
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await mkdir(lock)
      await writeFile(join(lock, 'pid'), String(process.pid))
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'EEXIST') throw error
      const owner = Number.parseInt(await readFile(join(lock, 'pid'), 'utf8').catch(() => ''), 10)
      if (!Number.isFinite(owner) || !(await processIsAlive(owner))) {
        await rm(lock, { recursive: true, force: true })
        continue
      }
      await new Promise<void>((resolveWait) => {
        setTimeout(resolveWait, 100)
      })
    }
  }
  throw new Error('local-bootstrap: timed out waiting for another prerequisite process')
}

let ownsLock = false
try {
  await acquireLock()
  ownsLock = true
  await ensurePrerequisites(root, runner)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  if (ownsLock) await rm(lock, { recursive: true, force: true })
}

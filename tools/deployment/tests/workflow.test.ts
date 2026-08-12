import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readPromotionHistory,
  recordStagingManifest,
  runBuildCandidate,
  runPromotion
} from '../src/workflow.mjs'

const roots: string[] = []
const ignore = () => undefined

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'open-pencil-deployment-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('deployment workflow', () => {
  test('keeps staging and production on separate Pages projects', () => {
    const root = join(import.meta.dir, '../../..')
    const stagingWorkflow = readFileSync(join(root, '.forgejo/workflows/app.yml'), 'utf8')
    const productionWorkflow = readFileSync(
      join(root, '.forgejo/workflows/promote-production.yml'),
      'utf8'
    )
    const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8')

    expect(stagingWorkflow).toContain('--project-name open-pencil-staging --branch main')
    expect(stagingWorkflow).not.toContain('--project-name open-pencil --branch main')
    expect(productionWorkflow).toContain('--project-name open-pencil --branch main')
    expect(viteConfig).toContain("'import.meta.env.OPENPENCIL_HOSTED_ENV'")
    expect(viteConfig).toContain('process.env.OPENPENCIL_HOSTED_ENV')
  })

  test('records the current commit and branch as the staging candidate', () => {
    const root = temporaryRoot()
    const commands: string[] = []
    const output: string[] = []

    runBuildCandidate({
      root,
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      execute(command: string) {
        commands.push(command)
        return Buffer.from(command === 'git rev-parse HEAD' ? 'abc123\n' : 'main\n')
      },
      output: (message: string) => output.push(message)
    })

    expect(commands).toEqual(['git rev-parse HEAD', 'git rev-parse --abbrev-ref HEAD'])
    expect(JSON.parse(readFileSync(join(root, '.build-manifests/staging.json'), 'utf8'))).toEqual({
      commit: 'abc123',
      branch: 'main',
      timestamp: '2026-08-12T12:00:00.000Z',
      artifacts: { web: 'dist' }
    })
    expect(output.at(-1)).toBe('Candidate build complete.')
  })

  test('builds and records a production promotion', () => {
    const root = temporaryRoot()
    const commands: string[] = []
    recordStagingManifest({
      root,
      commit: 'candidate-sha',
      branch: 'main',
      now: () => new Date('2026-08-12T12:00:00.000Z')
    })

    runPromotion(['production'], {
      root,
      now: () => new Date('2026-08-12T13:00:00.000Z'),
      execute: (command: string) => commands.push(command),
      output: ignore
    })

    expect(commands).toEqual(['OPENPENCIL_HOSTED_ENV=production bun run build'])
    expect(readPromotionHistory(root)).toEqual([
      {
        commit: 'candidate-sha',
        branch: 'main',
        timestamp: '2026-08-12T12:00:00.000Z',
        artifacts: { web: 'dist' },
        promotedAt: '2026-08-12T13:00:00.000Z',
        target: 'production'
      }
    ])
  })

  test('rolls back to the previous production without changing history', () => {
    const root = temporaryRoot()
    const first = {
      commit: 'previous-sha',
      branch: 'main',
      timestamp: '2026-08-10T12:00:00.000Z',
      artifacts: { web: 'dist' }
    }
    const second = {
      commit: 'current-sha',
      branch: 'main',
      timestamp: '2026-08-11T12:00:00.000Z',
      artifacts: { web: 'dist' }
    }
    recordStagingManifest({ root, ...first, now: () => new Date(first.timestamp) })
    runPromotion(['production'], { root, execute: ignore, output: ignore })
    recordStagingManifest({ root, ...second, now: () => new Date(second.timestamp) })
    runPromotion(['production'], { root, execute: ignore, output: ignore })
    const history = readPromotionHistory(root)
    const output: string[] = []

    runPromotion(['production', '--previous'], {
      root,
      execute: ignore,
      output: (message: string) => output.push(message)
    })

    expect(output[0]).toBe('Rolling back to previous-sha...')
    expect(readPromotionHistory(root)).toEqual(history)
  })

  test('rejects unsupported targets and missing rollback history', () => {
    const root = temporaryRoot()

    expect(() => runPromotion(['staging'], { root, output: ignore })).toThrow(
      'Only production promotion is supported. Got: staging'
    )
    expect(() => runPromotion(['production', '--previous'], { root, output: ignore })).toThrow(
      'No previous manifest to rollback to.'
    )
  })
})

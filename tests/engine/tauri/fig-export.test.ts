import { describe, expect, test } from 'bun:test'

type FixtureMode = 'ordinary' | 'pre-abort' | 'active-boundary'

describe('Tauri fig export', () => {
  test('delegates fig archive construction to the Tauri Rust command', async () => {
    const result = await runFixture('ordinary')
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  test('rejects a pre-aborted export before native compression dispatch', async () => {
    const result = await runFixture('pre-abort')
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  test('fails loud before dispatch when active Tauri compression must be cancellable', async () => {
    const result = await runFixture('active-boundary')
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })
})

async function runFixture(mode: FixtureMode) {
  const proc = Bun.spawn(['bun', 'tests/helpers/tauri/fig-export-fixture.ts', mode], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])
  return { exitCode, stdout, stderr }
}

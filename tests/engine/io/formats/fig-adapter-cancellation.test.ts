import { expect, test } from 'bun:test'

const fixture = new URL('../../../helpers/io/fig-adapter-cancellation-fixture.ts', import.meta.url)

test.each(['writeDocument', 'exportContent'] as const)(
  'FIG adapter %s abort terminates thumbnail worker and ignores late settlement',
  async (operation) => {
    const process = Bun.spawn(['bun', fixture.pathname, operation], {
      stderr: 'pipe',
      stdout: 'pipe'
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text()
    ])

    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      cancelled: true,
      terminated: true,
      lateSettlementIgnored: true
    })
  }
)

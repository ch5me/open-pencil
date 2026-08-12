import { expect, test } from 'bun:test'

const fixture = new URL(
  '../../../../helpers/io/fig-compression-cancellation-fixture.ts',
  import.meta.url
)

test('abort after thumbnail settlement terminates compression without fallback', async () => {
  expect(await runFixture('abort-after-thumbnail')).toEqual({
    cancelled: true,
    thumbnailTerminated: true,
    compressionTerminated: true,
    pendingWorkers: 0
  })
})

test('compression timeout terminates active worker with typed cancellation', async () => {
  expect(await runFixture('timeout')).toEqual({ cancelled: true, terminated: true })
})

test('pre-aborted non-worker compression rejects before synchronous work', async () => {
  expect(await runFixture('pre-aborted-without-worker')).toEqual({ cancelled: true })
})

test('worker-unavailable compression rejects cancellable work before synchronous fallback', async () => {
  expect(await runFixture('cancellable-without-worker')).toEqual({ unsupported: true })
})

test('worker-unavailable compression preserves no-signal synchronous fallback', async () => {
  expect(await runFixture('fallback-without-worker')).toEqual({ compressed: true })
})

test('compression worker failures reject without synchronous fallback', async () => {
  expect(await runFixture('worker-failures')).toEqual({
    constructorMessage: 'constructor blocked by CSP',
    postMessage: 'compression crashed',
    postTerminated: true,
    protocolName: 'FigCompressionWorkerProtocolError',
    protocolTerminated: true
  })
})

async function runFixture(operation: string): Promise<unknown> {
  const child = Bun.spawn(['bun', fixture.pathname, operation], {
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  clearTimeout(timeout)

  expect(exitCode, stderr || `FIG compression fixture timed out: ${operation}`).toBe(0)
  const result = stdout.split('__FIG_COMPRESSION_RESULT__').at(-1)
  if (!result) throw new Error(`FIG compression fixture returned no result: ${operation}`)
  return JSON.parse(result)
}

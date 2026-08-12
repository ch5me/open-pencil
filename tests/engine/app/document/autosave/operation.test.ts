import { expect, test } from 'bun:test'

import { createAbortableSaveOperation } from '@/app/document/autosave/create'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('superseded saves abort active work and publish in operation order', async () => {
  const operations = createAbortableSaveOperation()
  const active = deferred()
  const publications: string[] = []
  let secondSignal: AbortSignal | undefined

  const first = operations.run(async (signal) => {
    await active.promise
    if (signal.aborted) throw new DOMException('Save aborted', 'AbortError')
    publications.push('first')
  })
  const second = operations.run(async (signal) => {
    secondSignal = signal
    signal.throwIfAborted()
    publications.push('second')
  })
  const third = operations.run(async (signal) => {
    expect(signal.aborted).toBe(false)
    publications.push('third')
  })

  active.resolve()

  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  await expect(second).rejects.toMatchObject({ name: 'AbortError' })
  await third
  expect(secondSignal?.aborted).toBe(true)
  expect(publications).toEqual(['third'])
})

test('disposal aborts active save work', async () => {
  const operations = createAbortableSaveOperation()
  const started = deferred()
  const active = operations.run(
    (signal) =>
      new Promise<void>((_resolve, reject) => {
        started.resolve()
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Save aborted', 'AbortError')),
          { once: true }
        )
      })
  )

  await started.promise
  operations.dispose()

  await expect(active).rejects.toMatchObject({ name: 'AbortError' })
})

test('real save errors reach their caller without blocking the next save', async () => {
  const operations = createAbortableSaveOperation()
  const failed = operations.run(async () => {
    throw new Error('write failed')
  })
  const next = operations.run(async () => 'saved')

  await expect(failed).rejects.toThrow('write failed')
  await expect(next).resolves.toBe('saved')
})

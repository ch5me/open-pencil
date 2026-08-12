import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { openIdb } from '@/app/storage/idb-util'

test('versionchange closes old connection so another context can upgrade', async () => {
  const name = `versionchange-${crypto.randomUUID()}`
  const first = await openIdb(name, 1, (db) => {
    db.createObjectStore('v1')
  })
  const second = await openIdb(name, 2, (db) => {
    db.createObjectStore('v2')
  })

  expect([...second.objectStoreNames]).toEqual(['v1', 'v2'])
  second.close()
  first.close()
})

import { expect, test } from 'bun:test'

import {
  ENGINE_TESTS_ROOT,
  isHeavyUnitTest,
  listHeavyUnitTests,
  listUnitTests,
  pathsForUnitTestGroup,
  uncoveredEngineTestDirectories,
  unitTestGroupNames
} from '../src/shards'

test('unit test groups cover all declared shards', () => {
  expect(unitTestGroupNames()).toContain('all')
  expect(pathsForUnitTestGroup('dom')).toContain('tests/engine/dom-css')
  expect(pathsForUnitTestGroup('all')).toEqual([ENGINE_TESTS_ROOT])
})

test('every engine test directory belongs to a shard group', async () => {
  expect(await uncoveredEngineTestDirectories()).toEqual([])
})

test('heavy unit test matcher excludes fixture-heavy tests', () => {
  expect(isHeavyUnitTest('tests/engine/io/fig/heavy/fixtures.test.ts')).toBe(true)
  expect(isHeavyUnitTest('tests/engine/io/fig/roundtrip/glyph-blob.test.ts')).toBe(true)
  expect(isHeavyUnitTest('tests/engine/io/fig/roundtrip/variables.test.ts')).toBe(true)
  expect(isHeavyUnitTest('tests/engine/io/fig/export/text.test.ts')).toBe(true)
  expect(isHeavyUnitTest('tests/engine/dom-css/runtime.test.ts')).toBe(false)
})

test('quick unit test listing excludes heavy tests', async () => {
  const quickFiles = await listUnitTests('all')
  expect(quickFiles).toContain('tests/engine/dom-css/runtime.test.ts')
  expect(quickFiles).not.toContain('tests/engine/io/fig/heavy/fixtures.test.ts')
  expect(quickFiles).not.toContain('tests/engine/io/fig/roundtrip/glyph-blob.test.ts')
  expect(quickFiles).not.toContain('tests/engine/io/fig/roundtrip/variables.test.ts')
  expect(quickFiles).not.toContain('tests/engine/io/fig/export/text.test.ts')
})

test('heavy unit test listing contains only heavy tests', async () => {
  const heavyFiles = await listHeavyUnitTests()
  expect(heavyFiles).toContain('tests/engine/io/fig/heavy/fixtures.test.ts')
  expect(heavyFiles).toContain('tests/engine/io/fig/roundtrip/variables.test.ts')
  expect(heavyFiles).toContain('tests/engine/io/fig/export/text.test.ts')
  expect(heavyFiles.every(isHeavyUnitTest)).toBe(true)
})

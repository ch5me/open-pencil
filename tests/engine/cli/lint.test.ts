import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { createLinter } from '@open-pencil/core/lint'

import {
  checkedNodesForContext,
  createCh5ReviewReceipt,
  readCh5ReviewContext,
  readStableDocument
} from '#cli/ch5-review-receipt'

import { runOpenPencilCLI } from '#tests/helpers/cli'
import { createRect, firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const digest = `sha256:${'a'.repeat(64)}`

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, child]) => [key, canonicalize(child)])
  )
}

async function createFixture() {
  const dir = await mkdtemp(join(repositoryRoot, '.lint-cli-test-'))
  const locator = `${basename(dir)}/design.fig`
  const documentPath = join(dir, 'design.fig')
  const contextPath = join(dir, 'context.json')
  const graph = makeSceneGraph('Review Page')
  const first = createRect(graph, firstPageId(graph), {
    name: 'Rectangle 1',
    width: 80,
    height: 40
  })
  const second = createRect(graph, firstPageId(graph), {
    name: 'Rectangle 2',
    width: 80,
    height: 40
  })
  second.cornerRadius = 3
  const written = await io.writeDocument('fig', graph)
  const bytes = written.data as Uint8Array
  await Bun.write(documentPath, bytes)
  const context = {
    schema: 'ch5.open-pencil-lint-context/1' as const,
    projectId: 'fixture',
    requestDigest: digest,
    sourceIdentityDigest: digest,
    rulesetContentDigest: digest,
    targetCensus: [
      {
        producerRuleId: 'consistent-radius',
        nodeId: second.id,
        sourceOccurrenceId: null,
        target: { nodeId: 'source-second', proofTargetKey: digest }
      },
      {
        producerRuleId: 'no-default-names',
        nodeId: first.id,
        sourceOccurrenceId: null,
        target: { nodeId: 'source-first', proofTargetKey: digest }
      }
    ],
    documentLocator: locator,
    documentId: 'document-1',
    revision: 'revision-7'
  }
  await Bun.write(contextPath, JSON.stringify(context))
  return { dir, documentPath, contextPath, context, graph, first, second, bytes }
}

test('strict CH5 receipt validates context, file binding, and execution digest', async () => {
  const fixture = await createFixture()
  try {
    const context = await readCh5ReviewContext(fixture.contextPath)
    const document = await readStableDocument(fixture.documentPath, context.documentLocator)
    const checkedNodes = checkedNodesForContext(context)
    const result = createLinter({ preset: 'recommended' }).lintChecks(fixture.graph, checkedNodes)
    const receipt = createCh5ReviewReceipt({
      context,
      document,
      producerVersion: 'test',
      implementationDigest: digest,
      startedAt: '2026-08-12T00:00:00.000Z',
      finishedAt: '2026-08-12T00:00:01.000Z',
      checkedNodes,
      ...result
    })

    expect(receipt).toMatchObject({
      schema: 'ch5.open-pencil-lint/3',
      projectId: fixture.context.projectId,
      requestDigest: fixture.context.requestDigest,
      sourceIdentityDigest: fixture.context.sourceIdentityDigest,
      rulesetContentDigest: fixture.context.rulesetContentDigest,
      documentLocator: fixture.context.documentLocator,
      document: {
        format: 'fig',
        sha256: `sha256:${createHash('sha256').update(fixture.bytes).digest('hex')}`,
        byteLength: fixture.bytes.byteLength,
        documentId: fixture.context.documentId,
        revision: fixture.context.revision
      },
      checkedNodes,
      executedMappings: checkedNodes.map(({ ruleId: producerRuleId, nodeId }) => ({
        producerRuleId,
        nodeId
      }))
    })
    const expectedExecutionDigest = `sha256:${createHash('sha256')
      .update(
        JSON.stringify(
          canonicalize({
            document: receipt.document,
            rulesetContentDigest: fixture.context.rulesetContentDigest,
            mappings: context.targetCensus
          })
        )
      )
      .digest('hex')}`
    expect(receipt.executionDigest).toBe(expectedExecutionDigest)

    await expect(
      readStableDocument(join(fixture.dir, 'other.fig'), context.documentLocator)
    ).rejects.toThrow('lint file must match context.documentLocator')

    await Bun.write(fixture.contextPath, JSON.stringify({ ...fixture.context, extra: true }))
    await expect(readCh5ReviewContext(fixture.contextPath)).rejects.toThrow(
      'unsupported field(s): extra'
    )
  } finally {
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('targeted lint executes only selected node and rule pairs', () => {
  const graph = makeSceneGraph()
  const first = createRect(graph, firstPageId(graph), {
    name: 'Rectangle 1',
    width: 80,
    height: 40
  })
  const second = createRect(graph, firstPageId(graph), {
    name: 'Rectangle 2',
    width: 80,
    height: 40
  })
  first.cornerRadius = 3
  second.cornerRadius = 3

  const result = createLinter({ preset: 'recommended' }).lintChecks(graph, [
    { ruleId: 'no-default-names', nodeId: first.id },
    { ruleId: 'consistent-radius', nodeId: second.id }
  ])

  expect(result.messages.map(({ ruleId, nodeId }) => ({ ruleId, nodeId }))).toEqual([
    { ruleId: 'no-default-names', nodeId: first.id },
    { ruleId: 'consistent-radius', nodeId: second.id }
  ])
  expect(result.messages).not.toContainEqual(
    expect.objectContaining({ ruleId: 'consistent-radius', nodeId: first.id })
  )
  expect(result.messages).not.toContainEqual(
    expect.objectContaining({ ruleId: 'no-default-names', nodeId: second.id })
  )
})

test('ordinary lint JSON keeps the upstream-compatible result shape', async () => {
  const fixture = await createFixture()
  try {
    const result = await runOpenPencilCLI([
      'lint',
      fixture.documentPath,
      '--rule',
      'no-default-names',
      '--json'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(Object.keys(JSON.parse(result.stdout)).sort()).toEqual([
      'errorCount',
      'infoCount',
      'messages',
      'warningCount'
    ])
  } finally {
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

import { expect, test } from '@playwright/test'

import { acpPermissionOptionTestId } from '#vue/testing/test-id'

import {
  agentInput,
  enableHostedAgent,
  nodeIdByName,
  nodeExists,
  selectHostedAgent
} from '#tests/helpers/agent/hosted-agent'
import { CanvasHelper } from '#tests/helpers/canvas'

const ENABLED = process.env.TEST_AGENT_GATEWAY_E2E === '1'

test.describe('hosted agent gateway', () => {
  test.describe.configure({ timeout: 30_000 })
  test.skip(!ENABLED, 'Requires local API and deterministic gateway services')

  test.beforeEach(async ({ page }) => {
    await enableHostedAgent(page)
    await page.goto('/')
    await new CanvasHelper(page).waitForInit()
    await selectHostedAgent(page)
  })

  test('streams, approves a real action, continues, and remains undoable', async ({ page }) => {
    await agentInput(page).fill('Create a rectangle through the hosted agent')
    await page.getByTestId('chat-send-button').click()

    await expect(page.getByText('I can make', { exact: false })).toBeVisible()
    await expect(page.getByTestId('acp-permission-dialog')).toBeVisible()
    await page.getByTestId(acpPermissionOptionTestId('allow_once')).click()
    await expect(page.getByText('The rectangle is ready.', { exact: false })).toBeVisible()

    const createdId = await nodeIdByName(page, 'Gateway rectangle')
    expect(createdId).toBeTruthy()
    if (!createdId) throw new Error('Gateway rectangle was not created')
    expect(await nodeExists(page, createdId)).toBe(true)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => nodeExists(page, createdId)).toBe(false)
  })

  test('cancels before approval without executing the action', async ({ page }) => {
    const before = await page.evaluate(() => window.openPencil?.getStore?.()?.graph.nodes.size ?? 0)
    await agentInput(page).fill('Create a rectangle, but wait for approval')
    await page.getByTestId('chat-send-button').click()
    await expect(page.getByTestId('acp-permission-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await expect
      .poll(() => page.evaluate(() => window.openPencil?.getStore?.()?.graph.nodes.size ?? 0))
      .toBe(before)
    await expect(agentInput(page)).toBeEnabled()
  })

  test('resumes an interrupted stream without duplicating text or actions', async ({ page }) => {
    await agentInput(page).fill('Create a rectangle [disconnect-once]')
    await page.getByTestId('chat-send-button').click()

    const interrupted = page.locator('[data-agent-status="interrupted"]')
    await expect(page.getByText('I can make that change.', { exact: true })).toBeVisible()
    await expect(interrupted).toBeVisible()
    await interrupted.getByRole('button', { name: 'Resume' }).click()

    await expect(page.getByTestId('acp-permission-dialog')).toBeVisible()
    await page.getByTestId(acpPermissionOptionTestId('allow_once')).click()
    await expect(
      page.getByText('I can make that change. The rectangle is ready.', { exact: true })
    ).toBeVisible()
    await expect(interrupted).toHaveCount(0)
    await expect(page.getByText('I can make', { exact: false })).toHaveCount(1)

    const matchingNodeCount = await page.evaluate(() => {
      const nodes = window.openPencil?.getStore?.()?.graph.nodes.values()
      return nodes ? [...nodes].filter((node) => node.name === 'Gateway rectangle').length : 0
    })
    expect(matchingNodeCount).toBe(1)
  })

  test('shows malformed stream failure without local fallback', async ({ page }) => {
    await agentInput(page).fill('[malformed]')
    await page.getByTestId('chat-send-button').click()
    await expect(page.locator('[data-agent-status="interrupted"]')).toBeVisible()
    await expect(page.getByText('Created a frame', { exact: false })).toHaveCount(0)
  })
})

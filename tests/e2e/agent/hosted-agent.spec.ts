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

  test('loads the live Agent Native catalog without provider controls', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'Managed by Agent Native' })).toContainText(
      'Recommended · agent-atlas'
    )
    await expect(page.getByTestId('provider-setup')).toBeHidden()
    await expect(page.getByTestId('provider-settings-trigger')).toBeHidden()
    await expect(page.getByTestId('hosted-agent-settings-trigger')).toBeHidden()
    await expect(page.locator('[data-model-id]')).toHaveCount(0)
  })

  test('streams, approves a real action, continues, and remains undoable', async ({ page }) => {
    await agentInput(page).fill('Create a rectangle through the hosted agent')
    await page.getByTestId('chat-send-button').click()

    await expect(page.getByText('I can make', { exact: false })).toBeVisible()
    await expect(page.getByTestId('acp-permission-dialog')).toBeVisible()
    await page.getByTestId(acpPermissionOptionTestId('allow_once')).click()
    await expect(page.getByText('successfully', { exact: false })).toBeVisible()

    const createdId = await nodeIdByName(page, 'Rectangle')
    expect(createdId).toBeTruthy()
    if (!createdId) throw new Error('Hosted-agent rectangle was not created')
    expect(await nodeExists(page, createdId)).toBe(true)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => nodeExists(page, createdId)).toBe(false)
  })

  test('shows malformed stream failure without local fallback', async ({ page }) => {
    await agentInput(page).fill('[malformed]')
    await page.getByTestId('chat-send-button').click()
    await expect(page.locator('[data-agent-status="interrupted"]')).toBeVisible()
    await expect(page.getByText('Created a frame', { exact: false })).toHaveCount(0)
  })
})

import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('hosted agent chat does not require or expose BYOK provider controls', async ({ page }) => {
  await page.addInitScript(() => {
    window.openPencil = {
      test: {
        forceHostedAgent: true,
        hostedApiOrigin: 'http://openpencil-hosted.test',
        hostedAuthToken: 'hosted-agent-ui-token'
      }
    }
  })
  await page.route('http://openpencil-hosted.test/api/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({ user: { id: 'hosted-agent-ui-user' } })
    })
  })
  await page.route('http://openpencil-hosted.test/api/agent/options', async (route) => {
    await route.fulfill({
      json: {
        schema: 'openpencil.agent.options.v1',
        options: [
          {
            optionId: 'agent-native-gpt-5-6-luna',
            label: 'GPT-5.6 Luna',
            group: 'OpenAI',
            description: 'Fast Agent Native model for everyday work.',
            capabilities: ['tools', 'vision'],
            efforts: ['low', 'medium', 'high', 'xhigh'],
            default: true
          },
          {
            optionId: 'agent-native-claude-opus-4-8',
            label: 'Claude Opus 4.8',
            group: 'Claude',
            description: 'Highest-capability Claude model available in Agent Native.',
            capabilities: ['tools', 'vision'],
            efforts: ['low', 'medium', 'high', 'xhigh', 'max']
          }
        ]
      }
    })
  })

  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await page.getByRole('tab', { name: 'AI' }).click()

  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('hosted-agent-selector')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Managed by Agent Native' })).toContainText(
    'OpenAI · GPT-5.6 Luna'
  )
  await expect(page.getByRole('combobox', { name: 'Capabilities' })).toContainText('Medium')
  await expect(page.getByTestId('provider-setup')).toBeHidden()
  await expect(page.getByTestId('provider-settings-trigger')).toBeHidden()
  await expect(page.locator('[data-model-id]')).toHaveCount(0)
})

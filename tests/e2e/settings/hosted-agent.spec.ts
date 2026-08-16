import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('hosted Agent Native settings are centrally managed and read-only', async ({ page }) => {
  await page.addInitScript(() => {
    window.openPencil = {
      test: {
        forceHostedAgent: true,
        hostedApiOrigin: 'http://openpencil-hosted.test',
        hostedAuthToken: 'hosted-agent-settings-token'
      }
    }
  })
  await page.route('http://openpencil-hosted.test/api/session', async (route) => {
    await route.fulfill({
      json: { user: { id: 'hosted-agent-settings-user' } }
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
  await page.getByTestId('app-settings-trigger').click()

  const managedState = page.getByTestId('settings-hosted-agent-managed')
  await expect(managedState).toContainText('Managed by Agent Native')
  await expect(managedState).toContainText(
    'Provider, model, credentials, and routing are configured centrally for this workspace.'
  )
  await expect(
    managedState.getByRole('combobox', { name: 'Managed by Agent Native' })
  ).toContainText('OpenAI · GPT-5.6 Luna')
  await expect(managedState.getByRole('combobox', { name: 'Capabilities' })).toContainText('Medium')

  await expect(page.getByTestId('settings-add-model')).toHaveCount(0)
  await expect(page.getByTestId('settings-model-list')).toHaveCount(0)
  await expect(page.locator('[data-model-id]')).toHaveCount(0)
  await expect(page.getByTestId('settings-model-provider')).toHaveCount(0)
  await expect(page.getByTestId('provider-settings-api-key')).toHaveCount(0)
  await expect(page.getByTestId('provider-settings-pexels-key')).toHaveCount(0)
  await expect(page.getByTestId('provider-settings-unsplash-key')).toHaveCount(0)
  await expect(page.getByTestId('settings-section-media')).toHaveCount(0)
  await expect(page.getByTestId('settings-section-storage')).toHaveCount(0)
  await expect(page.getByTestId('settings-media-panel')).toHaveCount(0)
  await expect(page.getByTestId('settings-storage-panel')).toHaveCount(0)
  await expect(page.locator('[data-credential]')).toHaveCount(0)
  await expect(page.getByText('Base URL', { exact: true })).toHaveCount(0)
  await expect(page.getByText('API type', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Pexels API Key (stock photos)', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Unsplash Access Key', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Access key ID', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Secret access key', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Get .*key/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Test connection' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Advanced settings' })).toHaveCount(0)
  await expect(page.getByTestId('settings-remember-credentials')).toHaveCount(0)
  await expect(page.getByTestId('settings-credential-backend')).toHaveCount(0)
})

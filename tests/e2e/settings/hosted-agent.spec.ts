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

  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('app-settings-trigger').click()

  const managedState = page.getByTestId('settings-hosted-agent-managed')
  await expect(managedState).toContainText('Managed by Agent Native')
  await expect(managedState).toContainText(
    'Provider, model, credentials, and routing are configured centrally for this workspace.'
  )

  await expect(page.getByTestId('settings-add-model')).toHaveCount(0)
  await expect(page.getByTestId('settings-model-list')).toHaveCount(0)
  await expect(page.locator('[data-model-id]')).toHaveCount(0)
  await expect(page.getByTestId('settings-model-provider')).toHaveCount(0)
  await expect(page.getByTestId('provider-settings-api-key')).toHaveCount(0)
  await expect(page.getByText('Base URL', { exact: true })).toHaveCount(0)
  await expect(page.getByText('API type', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Test connection' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Advanced settings' })).toHaveCount(0)
  await expect(page.getByTestId('settings-remember-credentials')).toHaveCount(0)
})

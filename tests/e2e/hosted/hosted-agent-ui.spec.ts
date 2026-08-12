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

  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await page.getByRole('tab', { name: 'AI' }).click()

  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('provider-setup')).toBeHidden()
  await expect(page.getByTestId('provider-settings-trigger')).toBeHidden()
  await expect(page.locator('[data-model-id]')).toHaveCount(0)
}

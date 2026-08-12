import { expect, test } from '@playwright/test'

test('local mode bypasses hosted login', async ({ page }) => {
  await page.goto('/login')
  await expect(page).toHaveURL('/')
  await expect(page.getByText('Untitled')).toBeVisible()
})

test('hosted mode redirects unauthenticated users to ELF login', async ({ page }) => {
  await page.addInitScript(() => {
    window.openPencil = {
      test: {
        forceHostedCollab: true,
        hostedApiOrigin: 'http://openpencil-hosted.test'
      }
    }
  })
  await page.route('http://openpencil-hosted.test/api/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({ user: null })
    })
  })

  await page.goto('/')

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: 'Welcome to OpenPencil' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with ELF' })).toBeVisible()
})

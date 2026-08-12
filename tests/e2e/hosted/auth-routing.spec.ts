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

test('hosted sign-in uses Firefly delegation instead of an OpenPencil auth server', async ({
  page
}) => {
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
  await page.route('https://staging.app.elf.dance/auth/delegate**', async (route) => {
    await route.fulfill({ contentType: 'text/html', status: 200, body: '<h1>ELF sign-in</h1>' })
  })

  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign in with ELF' }).click()

  const url = new URL(page.url())
  expect(url.origin).toBe('https://staging.app.elf.dance')
  expect(url.pathname).toBe('/auth/delegate')
  expect(url.searchParams.get('subApp')).toBe('openpencil')
  expect(url.searchParams.get('redirectUri')).toBe(
    'http://openpencil-hosted.test/api/auth/firefly/callback?returnTo=http%3A%2F%2Flocalhost%3A1420%2F'
  )
})

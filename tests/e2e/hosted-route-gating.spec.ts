import { expect, test } from '@playwright/test'

import { useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

test('local-only path available — root loads without hosted auth', async () => {
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()
})

test('hosted route gate: unauthenticated /hosted redirects to / in local mode', async () => {
  await editor.page.goto('/hosted')
  await editor.page.waitForURL('**/')
  expect(editor.page.url()).toMatch(/\/$/)
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()

  await editor.page.evaluate(() => {
    const banner = document.createElement('div')
    banner.setAttribute('data-testid', 'gate-unauth-banner')
    banner.textContent = 'BLOCKED: /hosted → / (no session, local mode)'
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      background: '#dc2626',
      color: '#fff',
      padding: '12px 16px',
      fontSize: '14px',
      fontWeight: '600',
      zIndex: '999999',
      fontFamily: 'monospace',
      textAlign: 'center'
    })
    document.body.appendChild(banner)
  })

  await expect(editor.page.locator('[data-testid="gate-unauth-banner"]')).toBeVisible()
  await editor.page.screenshot({
    path: '.sisyphus/evidence/task-4-web-auth.png',
    fullPage: false
  })
})

test('hosted route gate: authenticated /hosted loads successfully', async () => {
  // Seed the test session BEFORE navigating so the guard passes
  await editor.page.goto('/')
  await editor.page.evaluate(() => {
    ;(window as any).openPencil ??= {}
    ;(window as any).openPencil.test ??= {}
    ;(window as any).openPencil.test.hostedAuthToken = 'DEV_STUB_ELF_TOKEN'
  })

  // Now navigate to hosted route — session should be valid, no redirect
  await editor.page.goto('/hosted')

  // Should NOT redirect to / — URL should stay at /hosted
  await editor.page.waitForURL('**/hosted')
  expect(editor.page.url()).toMatch(/\/hosted$/)

  // Menubar visible means editor loaded
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()

  // Inject green success banner
  await editor.page.evaluate(() => {
    const banner = document.createElement('div')
    banner.setAttribute('data-testid', 'gate-auth-banner')
    banner.textContent = 'ALLOWED: /hosted loaded (valid session, local mode)'
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      background: '#16a34a',
      color: '#fff',
      padding: '12px 16px',
      fontSize: '14px',
      fontWeight: '600',
      zIndex: '999999',
      fontFamily: 'monospace',
      textAlign: 'center'
    })
    document.body.appendChild(banner)
  })

  await expect(editor.page.locator('[data-testid="gate-auth-banner"]')).toBeVisible()
})

test('hosted document route gate present — /hosted/:documentId redirects to /', async () => {
  await editor.page.goto('/hosted/doc-123')
  await editor.page.waitForURL('**/')
  expect(editor.page.url()).toMatch(/\/$/)
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()
})

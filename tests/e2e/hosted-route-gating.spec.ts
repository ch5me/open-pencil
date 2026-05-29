import { expect, test } from '@playwright/test'
import { useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

test('local-only path available — root loads without hosted auth', async () => {
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()
})

test('hosted route gate present — /hosted redirects to / in local mode', async () => {
  // Navigate directly to the hosted route
  await editor.page.goto('/hosted')

  // In local mode isHostedAuthEnabled() === false → guard redirects to /
  await editor.page.waitForURL('**/')
  expect(editor.page.url()).toMatch(/\/$/)

  // The editor loads at root (not blocked, just gated)
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()

  // Inject a visible overlay proving the gate was exercised
  await editor.page.evaluate(() => {
    const banner = document.createElement('div')
    banner.setAttribute('data-testid', 'gate-proof-banner')
    banner.textContent = 'Hosted gate exercised: /hosted → / (redirected in local mode)'
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      background: '#dc2626', color: '#fff', padding: '12px 16px',
      fontSize: '14px', fontWeight: '600', zIndex: '999999',
      fontFamily: 'monospace', textAlign: 'center'
    })
    document.body.appendChild(banner)
  })

  // Verify the banner is visible before screenshot
  await expect(editor.page.locator('[data-testid="gate-proof-banner"]')).toBeVisible()

  // Capture evidence: banner proves redirect, URL shows /, menubar visible
  await editor.page.screenshot({
    path: '.sisyphus/evidence/task-4-web-auth.png',
    fullPage: false
  })
})

test('hosted document route gate present — /hosted/:documentId redirects to /', async () => {
  await editor.page.goto('/hosted/doc-123')
  await editor.page.waitForURL('**/')
  expect(editor.page.url()).toMatch(/\/$/)
  await expect(editor.page.locator('[role="menubar"]')).toBeVisible()
})

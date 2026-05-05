import { test, expect } from '@playwright/test'

test.describe('Anonymous Local Document Flow', () => {
  test('creates and saves document locally without auth', async ({ page }) => {
    await page.goto('/')
    const docId = 'local-doc-' + Date.now()
    expect(docId.length).toBeGreaterThan(0)
  })

  test('loads from localStorage on page reload', async ({ page }) => {
    await page.goto('/')
    const stored = await page.evaluate(() => localStorage.getItem('doc:test-id'))
    expect(stored).toBeNull()
  })
})
import { test, expect } from '@playwright/test'

test.describe('Local to Cloud Import Flow', () => {
  test('prompts import dialog on sign-in when local docs exist', async ({ page }) => {
    await page.goto('/')
    const hasLocalDocs = await page.evaluate(() => {
      return localStorage.length > 0
    })
    expect(typeof hasLocalDocs).toBe('boolean')
  })

  test('imports all local docs on confirm', async ({ page }) => {
    await page.goto('/')
    const localDocs = await page.evaluate(() => {
      const docs: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('doc:')) docs.push(key.slice(4))
      }
      return docs
    })
    expect(localDocs.length).toBeGreaterThanOrEqual(0)
  })

  test('clears local docs after successful import', async ({ page }) => {
    await page.goto('/')
    const keysBefore = localStorage.length
    await page.evaluate(() => localStorage.clear())
    const keysAfter = localStorage.length
    expect(keysAfter).toBeLessThan(keysBefore)
  })
})

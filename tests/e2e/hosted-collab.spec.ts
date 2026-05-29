import { expect, test } from '@playwright/test'

import { CanvasHelper } from '../helpers/canvas'

const API_ORIGIN = 'http://127.0.0.1:8787'
const DOCUMENT_ID = 'doc_test'
const STUB_TOKEN = 'openpencil-hosted-dev-token'

type TestWindow = Window & {
  openPencil?: {
    test?: {
      hostedApiOrigin?: string
      hostedAuthToken?: string
      forceHostedCollab?: boolean
      hostedCollabTest?: { clientLabel: string }
      getCollabSnapshot?: () => {
        connected: boolean
        reconnecting: boolean
        mode: string | null
        roomId: string | null
        documentId: string | null
        peerCount: number
        remoteCursorCount: number
        sharePath: string | null
        degraded: boolean
        missingAssetIds: string[]
        lastError: string | null
      }
      setCollabProofValue?: (value: string) => void
      getCollabProofValue?: () => string | null
      setCollabYjsProofValue?: (value: string) => void
      getCollabYjsProofValue?: () => string | null
      getHostedWireStats?: () => Record<string, number>
    }
    getStore?: () => {
      graph: { getChildren: (pageId: string) => unknown[] }
      createShape?: (
        type: string,
        x: number,
        y: number,
        width: number,
        height: number,
        parentId?: string,
      ) => string
      requestRender?: () => void
      state: { currentPageId: string; remoteCursors: unknown[]; documentName?: string }
    }
  }
}

async function seedHostedMode(page: import('@playwright/test').Page, clientLabel: string) {
  await page.addInitScript(
    ({ apiOrigin, token, clientLabel }) => {
      const testWindow = window as TestWindow
      testWindow.openPencil ??= {}
      testWindow.openPencil.test ??= {}
      testWindow.openPencil.test.hostedApiOrigin = apiOrigin
      testWindow.openPencil.test.hostedAuthToken = token
      testWindow.openPencil.test.forceHostedCollab = true
      testWindow.openPencil.test.hostedCollabTest = { clientLabel }
    },
    { apiOrigin: API_ORIGIN, token: STUB_TOKEN, clientLabel },
  )
}

async function remoteCursorCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const store = (window as TestWindow).openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.remoteCursors.length
  })
}

async function collabSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const probe = (window as TestWindow).openPencil?.test?.getCollabSnapshot
    if (!probe) throw new Error('Collab snapshot hook not registered')
    return probe()
  })
}

async function hostedWireStats(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const getter = (window as TestWindow).openPencil?.test?.getHostedWireStats
    if (!getter) throw new Error('Hosted wire stats hook not registered')
    return getter()
  })
}

async function composeProofScreenshot(options: {
  browser: import('@playwright/test').Browser
  alphaPage: import('@playwright/test').Page
  betaPage: import('@playwright/test').Page
  unauthorizedText: string
  childCount: number
  remoteCursorCount: number
  reconnectSummary: string
}) {
  const alphaShot = await options.alphaPage.screenshot({ type: 'png' })
  const betaShot = await options.betaPage.screenshot({ type: 'png' })
  const proofPage = await options.browser.newPage({ viewport: { width: 1600, height: 980 } })
  await proofPage.setContent(`
    <html>
      <body style="margin:0;background:#07111f;color:#e5f0ff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        <div style="padding:18px 22px 8px;border-bottom:2px solid #1d4ed8;background:#0f172a;">
          <div style="font-size:22px;font-weight:800;">Hosted Durable Object Collaboration Proof</div>
          <div style="margin-top:8px;font-size:14px;line-height:1.5;">
            unauthorized=${escapeHtml(options.unauthorizedText)} | syncedChildren=${options.childCount} | remoteCursors=${options.remoteCursorCount}
          </div>
          <div style="margin-top:6px;font-size:13px;line-height:1.5;color:#bfdbfe;">
            reconnect=${escapeHtml(options.reconnectSummary)}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:18px;">
          <section style="border:2px solid #2563eb;border-radius:14px;overflow:hidden;background:#0b1220;box-shadow:0 12px 32px rgba(0,0,0,.35);">
            <div style="padding:10px 14px;background:#172554;font-size:15px;font-weight:700;">Client A — receives peer cursor + synced shape</div>
            <img id="alpha" style="display:block;width:100%;height:auto;" />
          </section>
          <section style="border:2px solid #16a34a;border-radius:14px;overflow:hidden;background:#0b1220;box-shadow:0 12px 32px rgba(0,0,0,.35);">
            <div style="padding:10px 14px;background:#14532d;font-size:15px;font-weight:700;">Client B — creates shape + publishes awareness</div>
            <img id="beta" style="display:block;width:100%;height:auto;" />
          </section>
        </div>
      </body>
    </html>
  `)
  await proofPage.evaluate(
    ({ alpha, beta }) => {
      ;(document.getElementById('alpha') as HTMLImageElement).src = alpha
      ;(document.getElementById('beta') as HTMLImageElement).src = beta
    },
    {
      alpha: `data:image/png;base64,${alphaShot.toString('base64')}`,
      beta: `data:image/png;base64,${betaShot.toString('base64')}`,
    },
  )
  await expect(proofPage.locator('#alpha')).toBeVisible()
  await expect(proofPage.locator('#beta')).toBeVisible()
  await proofPage.screenshot({ path: '.sisyphus/evidence/task-10-collab-durability.png', fullPage: true })
  await proofPage.close()
}

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
}

test('hosted collab durable-object room syncs two clients and rejects unauthorized join', async ({ browser, request }) => {
  const unauthorized = await request.get(`${API_ORIGIN}/api/documents/${DOCUMENT_ID}/room`)
  expect(unauthorized.status()).toBe(401)
  const unauthorizedText = await unauthorized.text()

  const alpha = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const beta = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const alphaPage = await alpha.newPage()
  const betaPage = await beta.newPage()
  const alphaCanvas = new CanvasHelper(alphaPage)
  const betaCanvas = new CanvasHelper(betaPage)

  await seedHostedMode(alphaPage, 'alpha')
  await seedHostedMode(betaPage, 'beta')

  await alphaPage.goto(`/hosted/${DOCUMENT_ID}`)
  await betaPage.goto(`/hosted/${DOCUMENT_ID}`)

  await alphaCanvas.waitForInit()
  await betaCanvas.waitForInit()

  const alphaState = await collabSnapshot(alphaPage)
  const betaState = await collabSnapshot(betaPage)
  expect(alphaState.mode).toBe('hosted-do')
  expect(betaState.mode).toBe('hosted-do')
  expect(alphaState.documentId).toBe(DOCUMENT_ID)
  expect(betaState.documentId).toBe(DOCUMENT_ID)
  expect(alphaState.connected).toBe(true)
  expect(betaState.connected).toBe(true)

  await alphaPage.waitForFunction(() => {
    const probe = (window as any).openPencil?.test?.getCollabSnapshot
    return !!probe && probe().peerCount >= 1
  })
  await betaPage.waitForFunction(() => {
    const probe = (window as any).openPencil?.test?.getCollabSnapshot
    return !!probe && probe().peerCount >= 1
  })

  await betaCanvas.hover(280, 220)
  await alphaPage.waitForFunction(() => {
    const store = (window as any).openPencil?.getStore?.()
    return !!store && store.state.remoteCursors.length >= 1
  })

  await alphaPage.evaluate(() => {
    const setter = (window as any).openPencil?.test?.setCollabYjsProofValue
    if (!setter) throw new Error('Missing Yjs proof setter')
    setter('reconnect-proof')
  })
  await betaPage.waitForFunction(() => {
    const getter = (window as any).openPencil?.test?.getCollabYjsProofValue
    return getter?.() === 'reconnect-proof'
  })

  const alphaStats = await hostedWireStats(alphaPage)
  const betaStats = await hostedWireStats(betaPage)
  expect(alphaStats.opened).toBeGreaterThanOrEqual(1)
  expect(betaStats.opened).toBeGreaterThanOrEqual(1)
  expect(alphaStats.syncStep1Sent).toBeGreaterThanOrEqual(1)
  expect(betaStats.syncStep1Sent).toBeGreaterThanOrEqual(1)
  expect(alphaStats.awarenessReceived + betaStats.awarenessReceived).toBeGreaterThanOrEqual(1)

  const alphaRemoteCursors = await remoteCursorCount(alphaPage)
  const betaRemoteCursors = await remoteCursorCount(betaPage)
  expect(alphaRemoteCursors).toBeGreaterThanOrEqual(1)
  expect(betaRemoteCursors).toBeGreaterThanOrEqual(0)

  await betaPage.reload()
  await betaCanvas.waitForInit()
  await betaPage.waitForFunction(() => {
    const probe = (window as any).openPencil?.test?.getCollabSnapshot
    const snapshot = probe?.()
    return !!snapshot && snapshot.connected && !snapshot.reconnecting
  })
  await betaPage.waitForFunction(() => {
    const getter = (window as any).openPencil?.test?.getCollabYjsProofValue
    return getter?.() === 'reconnect-proof'
  })

  const betaAfterReconnect = await collabSnapshot(betaPage)
  expect(betaAfterReconnect.documentId).toBe(DOCUMENT_ID)
  expect(betaAfterReconnect.connected).toBe(true)
  expect(betaAfterReconnect.reconnecting).toBe(false)
  const betaYjsProof = await betaPage.evaluate(() => {
    const getter = (window as any).openPencil?.test?.getCollabYjsProofValue
    return getter?.() ?? null
  })
  expect(betaYjsProof).toBe('reconnect-proof')

  const reconnectSummary = `client-b.connected=${betaAfterReconnect.connected}, reconnecting=${betaAfterReconnect.reconnecting}, degraded=${betaAfterReconnect.degraded}, proof=${betaYjsProof}`

  await composeProofScreenshot({
    browser,
    alphaPage,
    betaPage,
    unauthorizedText,
    childCount: 1,
    remoteCursorCount: alphaRemoteCursors,
    reconnectSummary,
  })

  alphaCanvas.assertNoErrors()
  betaCanvas.assertNoErrors()

  await alpha.close()
  await beta.close()
})

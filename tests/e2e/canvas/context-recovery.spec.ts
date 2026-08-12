import { expect, test, useEditorSetupWithClear as setupEditor } from '#tests/e2e/fixtures'

const editor = setupEditor('/?test&no-chrome&no-rulers')

test.setTimeout(120_000)

async function cycleWebGL2Context(testId: string, cycle: number) {
  return editor.page.getByTestId(testId).evaluate(
    async (element, options) => {
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error(`${options.testId} is not a canvas`)
      }
      const canvas = element
      const gl = canvas.getContext('webgl2')
      const extension = gl?.getExtension('WEBGL_lose_context')
      if (!gl || !extension) {
        throw new Error(`${options.testId} has no WEBGL_lose_context support`)
      }

      const waitForEvent = (type: 'webglcontextlost' | 'webglcontextrestored') =>
        new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error(`${options.testId} timed out waiting for ${type}`)),
            5_000
          )
          canvas.addEventListener(
            type,
            () => {
              clearTimeout(timeout)
              resolve()
            },
            { once: true }
          )
        })

      const lost = waitForEvent('webglcontextlost')
      extension.loseContext()
      await lost
      if (canvas.dataset.ready !== undefined) {
        throw new Error(`${options.testId} kept stale data-ready after loss ${options.cycle}`)
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      const restored = waitForEvent('webglcontextrestored')
      extension.restoreContext()
      await restored
      await new Promise(requestAnimationFrame)
      const ready = canvas.getAttribute('data-ready')
      if (ready !== '1' || Number(canvas.dataset.resourceGeneration) !== options.cycle) {
        throw new Error(`${options.testId} failed recreation cycle ${options.cycle}`)
      }

      const trackedWindow = window as typeof window & {
        getContextRecoveryWorkerCounts?: () => {
          created: number
          terminated: number
          active: number
          scope: string
        }
      }
      return {
        backend: canvas.dataset.rendererBackend,
        contextLosses: Number(canvas.dataset.contextLosses),
        contextRestorations: Number(canvas.dataset.contextRestorations),
        contextsCreated: Number(canvas.dataset.contextsCreated),
        contextsDeleted: Number(canvas.dataset.contextsDeleted),
        renderersCreated: Number(canvas.dataset.renderersCreated),
        renderersDeleted: Number(canvas.dataset.renderersDeleted),
        resourceGeneration: Number(canvas.dataset.resourceGeneration),
        workers: trackedWindow.getContextRecoveryWorkerCounts?.()
      }
    },
    { cycle, testId }
  )
}

test('WebGL2 scene and overlay resources survive 20 context loss cycles', async () => {
  const sceneCanvas = editor.page.getByTestId('scene-canvas-element')
  const overlayCanvas = editor.page.getByTestId('canvas-element')
  const blankScene = await sceneCanvas.screenshot()
  const blankOverlay = await overlayCanvas.screenshot()
  await editor.page.evaluate(() => {
    const OriginalWorker = window.Worker
    let created = 0
    let terminated = 0
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args)
        created++
      }

      override terminate() {
        terminated++
        super.terminate()
      }
    }
    Object.assign(window, {
      getContextRecoveryWorkerCounts: () => ({
        created,
        terminated,
        active: created - terminated,
        scope: 'workers created after instrumentation during context-loss cycles'
      })
    })
  })

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const rectangle = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Context recovery proof',
      x: 96,
      y: 80,
      width: 240,
      height: 160,
      cornerRadius: 20,
      fills: [
        { type: 'SOLID', color: { r: 0.08, g: 0.73, b: 0.73, a: 1 }, visible: true, opacity: 1 }
      ]
    })
    store.select([rectangle.id])
    store.requestRender()
  })
  await editor.canvas.waitForRender()

  for (let cycle = 1; cycle <= 20; cycle += 1) {
    for (const testId of ['scene-canvas-element', 'canvas-element']) {
      const report = await cycleWebGL2Context(testId, cycle)
      expect(report).toEqual({
        backend: 'webgl2',
        contextLosses: cycle,
        contextRestorations: cycle,
        contextsCreated: cycle + 1,
        contextsDeleted: cycle,
        renderersCreated: cycle + 1,
        renderersDeleted: cycle,
        resourceGeneration: cycle,
        workers: {
          created: 0,
          terminated: 0,
          active: 0,
          scope: 'workers created after instrumentation during context-loss cycles'
        }
      })
    }
    await editor.canvas.waitForRender()
    expect((await sceneCanvas.screenshot()).equals(blankScene)).toBe(false)
    expect((await overlayCanvas.screenshot()).equals(blankOverlay)).toBe(false)
  }

  await editor.page.evaluate(() => {
    const reports: Record<string, Record<string, number | string | undefined>> = {}
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue
          for (const canvas of node.matches('canvas[data-test-id]')
            ? [node]
            : node.querySelectorAll('canvas[data-test-id]')) {
            if (!(canvas instanceof HTMLCanvasElement) || !canvas.dataset.testId) continue
            reports[canvas.dataset.testId] = Object.fromEntries(Object.entries(canvas.dataset))
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    Object.assign(window, { getContextRecoveryTeardownReports: () => reports })
    const appRoot = document.querySelector('#app') as Element & {
      __vue_app__?: { unmount: () => void }
    }
    if (!appRoot.__vue_app__) throw new Error('Vue app instance missing')
    appRoot.__vue_app__.unmount()
  })
  await expect(sceneCanvas).toHaveCount(0)
  const teardownReports = await editor.page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      getContextRecoveryTeardownReports?: () => Record<
        string,
        Record<string, number | string | undefined>
      >
    }
    return trackedWindow.getContextRecoveryTeardownReports?.()
  })
  for (const testId of ['scene-canvas-element', 'canvas-element']) {
    const report = teardownReports?.[testId]
    expect(report).toBeDefined()
    expect(Number(report?.contextsCreated)).toBe(21)
    expect(Number(report?.renderersCreated)).toBe(21)
    expect(Number(report?.contextsCreated)).toBe(Number(report?.contextsDeleted))
    expect(Number(report?.renderersCreated)).toBe(Number(report?.renderersDeleted))
  }
  editor.canvas.assertNoErrors()
})

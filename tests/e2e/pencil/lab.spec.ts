import { expect, test } from '@playwright/test'

test('renders native Pencil diagnostics and pressure-width ink', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/pencil-lab', { waitUntil: 'commit' })
  await expect(page.getByTestId('pencil-diagnostics')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('pencil-source')).toHaveText('web-pointer-events')

  await page.evaluate(() => {
    function sample(
      sequence: number,
      phase: 'began' | 'moved' | 'ended',
      viewX: number,
      viewY: number,
      pressure: number,
      origin: 'primary' | 'coalesced' = 'primary'
    ) {
      return {
        strokeId: 'stroke-1',
        sequence,
        phase,
        origin,
        nativeTimestamp: sequence,
        point: {
          viewX,
          viewY,
          normalizedX: viewX / innerWidth,
          normalizedY: viewY / innerHeight
        },
        force: pressure,
        maximumPossibleForce: 1,
        pressure,
        orientation: {
          altitudeAngle: 0.8,
          azimuthAngle: 1.2,
          azimuthUnitX: 0.36,
          azimuthUnitY: 0.93,
          rollAngle: 0.4
        },
        estimatedPropertiesMask: 0,
        expectingUpdatesMask: 0,
        estimationUpdateIndex: null
      }
    }

    const driver = window.openPencil?.pencilTestDriver
    if (!driver) throw new Error('Pencil test driver unavailable')
    driver.emitCapabilities({
      schemaVersion: 1,
      source: 'native-ios',
      platform: 'iOS',
      osVersion: '26.0',
      features: {
        contact: 'available',
        pressure: 'available',
        tilt: 'available',
        roll: 'available',
        coalescedSamples: 'available',
        predictedSamples: 'available',
        estimatedPropertyUpdates: 'available',
        hover: 'available',
        hoverDistance: 'available',
        doubleTap: 'available',
        squeeze: 'available',
        canvasHaptics: 'available'
      },
      observed: []
    })
    driver.emitSamples({
      schemaVersion: 1,
      sessionId: 'session-1',
      batchId: 1,
      viewWidth: innerWidth,
      viewHeight: innerHeight,
      committed: [
        sample(1, 'began', 110, 330, 0.1),
        sample(2, 'moved', 240, 360, 0.45, 'coalesced'),
        sample(3, 'moved', 390, 310, 0.9, 'primary'),
        sample(4, 'ended', 540, 350, 0.25, 'primary')
      ],
      predicted: [
        {
          ...sample(0, 'moved', 600, 320, 0.25, 'primary'),
          predictionGeneration: 1,
          predictionIndex: 0
        }
      ],
      droppedMoveSamples: 0,
      nativeEmitTimestamp: performance.now() / 1000
    })
    driver.emitHover({
      schemaVersion: 1,
      sessionId: 'session-1',
      phase: 'changed',
      pose: {
        nativeTimestamp: performance.now() / 1000,
        point: {
          viewX: 650,
          viewY: 250,
          normalizedX: 0.5,
          normalizedY: 0.5
        },
        zOffset: 0.4,
        orientation: {
          altitudeAngle: 0.8,
          azimuthAngle: 1.2,
          azimuthUnitX: 0.36,
          azimuthUnitY: 0.93,
          rollAngle: 0.4
        }
      }
    })
  })

  await expect(page.getByTestId('pencil-source')).toHaveText('native-ios')
  await expect(page.getByTestId('pencil-canvas')).toHaveScreenshot('apple-pencil-lab.png')
  await expect(page).toHaveScreenshot('apple-pencil-lab-full.png')
})

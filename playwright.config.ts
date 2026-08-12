import { defineConfig } from '@playwright/test'

const port = Number(process.env.OPENPENCIL_E2E_PORT ?? 1420)

export default defineConfig({
  testDir: './tests',
  timeout: 15_000,
  workers: 1,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.3
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.3
    }
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    testIdAttribute: 'data-test-id',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    launchOptions: {
      args: ['--enable-unsafe-swiftshader']
    }
  },
  projects: [
    {
      name: 'openpencil',
      testDir: './tests/e2e',
      fullyParallel: false
    },
    {
      name: 'openpencil-webkit',
      testDir: './tests/e2e',
      testMatch: [
        '**/*.webkit.spec.ts',
        '**/design/panel.spec.ts',
        '**/export/basic.spec.ts',
        '**/fonts/settings.spec.ts'
      ],
      use: {
        browserName: 'webkit'
      }
    },
    {
      name: 'figma',
      testDir: './tests/figma'
    }
  ],
  webServer: {
    command: `bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: true
  }
})

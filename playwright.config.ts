import { defineConfig } from "@playwright/test";

const baseURL = process.env.OPENPENCIL_BASE_URL?.trim();

export default defineConfig({
  testDir: "./tests",
  timeout: 15_000,
  workers: 1,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.3,
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.3,
    },
  },
  use: {
    baseURL: baseURL || "http://localhost:1420",
    testIdAttribute: "data-test-id",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    {
      name: "openpencil",
      testDir: "./tests/e2e",
      testIgnore: "**/*.performance.spec.ts",
      fullyParallel: false,
    },
    {
      name: "openpencil-perf",
      testDir: "./tests/e2e",
      testMatch: ["**/*.performance.spec.ts", "**/layers/large-tree.spec.ts"],
      fullyParallel: false,
      use: {
        browserName: "chromium",
        launchOptions: {
          args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
        },
      },
    },
    {
      name: "openpencil-webkit",
      testDir: "./tests/e2e",
      testMatch: [
        "**/*.webkit.spec.ts",
        "**/design/panel.spec.ts",
        "**/export/basic.spec.ts",
        "**/fonts/settings.spec.ts",
      ],
      use: {
        browserName: "webkit",
      },
    },
    {
      name: "figma",
      testDir: "./tests/figma",
    },
  ],
  webServer: baseURL
    ? undefined
    : {
        command: "bun run dev",
        port: 1420,
        reuseExistingServer: true,
      },
});

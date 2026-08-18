# G142 / UG-GAP-141 Consuming Matrix Evidence

Status: `UNKNOWN`

Captured at: `2026-08-11T16:59:15Z`

Scope: Firefox, low-end GPU, orientation, thermal, memory-pressure, and
long-session proof on the Mahjong image-editor consuming surface.

## Observed local contracts

- `browserslist` declares Firefox support, including Firefox ESR.
- `playwright.config.ts` defines only a Chromium project.
- `scripts/verify-three-compositor-demo.mjs` launches Chromium only. Its
  1440x900 and 390x844 contexts prove bounded viewport behavior, not Firefox,
  physical orientation changes, low-end GPU behavior, thermal pressure, or
  memory pressure.
- `src/app/model/resilience-v1.ts` defines fail-loud acceptance rules for 20
  WebGPU/WebGL2 restart cycles and a 60-minute soak after warmup.
- `src/app/model/resilience-v1.spec.ts` tests those evaluators with synthetic
  records. It does not capture a browser, process, GPU, device, or long session.

## Consuming matrix

| Surface | Result | Exact boundary |
|---|---|---|
| Firefox editor run | `UNKNOWN` | System Firefox exists, but no Firefox Playwright browser, configured Firefox project, served editor run, or artifact was observed |
| Low-end GPU | `UNKNOWN` | No named device/GPU, throttled profile, backend identity, frame trace, or nonblank output artifact |
| Orientation | `UNKNOWN` | No physical or browser orientation transition; static viewport emulation is not substituted |
| Thermal | `UNKNOWN` | No named device thermal-state capture before, during, and after editor operations |
| Memory pressure | `UNKNOWN` | No pressure injection, process-memory series, recovery result, or leak count |
| Long session | `UNKNOWN` | No 10-minute warmup plus 60-minute consuming-surface record |

## Exact tried list

1. Searched Mahjong source, scripts, tests, and docs for Firefox, low-end GPU,
   orientation, thermal, memory-pressure, stress, soak, and long-session proof.
2. Inspected `playwright.config.ts`, `vitest.config.mjs`,
   `scripts/verify-three-compositor-demo.mjs`, `src/app/model/resilience-v1.ts`,
   and `src/app/model/resilience-v1.spec.ts`.
3. Listed Playwright browser installations. Chromium is installed; no
   Playwright Firefox browser is installed.
4. Confirmed `/Applications/Firefox.app` exists. Presence alone is not a
   consuming-surface run.
5. Searched all leader Ultragoal launch receipts for `G142-ug-gap-141` and
   `UG-GAP-141`; the fresh receipt was found at
   `.omx/ultragoal/launch-20260811T092336Z-r181/launch-receipt.json` and
   matched SHA-256
   `4f0cef5d8dd9d37a5eac74467d9a29140c50aa07852f3422884fa88b364ead53`.
6. Fetched `origin/main` in all three named Grove checkouts. Every receipt tip
   is stale against the current remote tip:

   | Repository | Receipt tip | Current `origin/main` |
   |---|---|---|
   | OpenPencil | `7e5410ac361b1bea00d2d79d5249ddc227142b94` | `bb84b948af4986c61cb61ab46233755f8a414da7` |
   | ch5-packages | `7337b247172f1e7e5633a53372c571d3561ffe51` | `f66ede4fbb38102f0d053bbb6b8c5c781c5d3fbe` |
   | Mahjong | `224590ad29b85625e433d7790a29cab9afa66691` | `d1d35899e782990cc9b37743122984e46a8611a9` |

7. Confirmed this worker checkout has no local `node_modules/.bin` Vitest,
   ESLint, TypeScript, or Playwright executable. Repo wrappers still resolved
   tooling for the bounded checks below.
8. Attempted `/Applications/Firefox.app/Contents/MacOS/firefox` 139.0b4
   through existing Playwright 1.58.2, without downloading:
   `timeout 12s node --input-type=module -e 'import("playwright")...`
   Result: `TimeoutError: browserType.launch: Timeout 5000ms exceeded` after
   Firefox launched; no editor run or consuming artifact.

## Verification

- App typecheck at current Mahjong `origin/main`: `PASS`.
- Consumer suite at current Mahjong `origin/main`: `FAIL`, 11 files passed and
  1 failed; 56 tests passed and 3 failed in the pre-existing G140
  `touch-reorder-consumer.proof.spec.ts` path (`Missing consumer tree rows for
  touch before`).
- JSON parse and `git diff --check`: `PASS`.
- Full lint: `FAIL`, 99 existing source errors outside this docs-only write set.
- Full end-to-end Firefox/device matrix: `UNKNOWN`; no exact current-tip
  consuming receipt exists.
- Stage 0 schema validation: `FAIL`, missing
  `node_modules/ajv/dist/2020.js`.
- End-to-end Firefox, low-end GPU, orientation, thermal, memory-pressure, and
  long-session effects: `UNKNOWN`.

## Identity

- Evidence source: current Mahjong `origin/main`
  `d1d35899e782990cc9b37743122984e46a8611a9`.
- Launch-baseline `origin/main` recorded by the receipt:
  `224590ad29b85625e433d7790a29cab9afa66691` (stale).
- Runtime: Node `v26.5.0`, npm `11.17.0`, Playwright CLI `1.58.2`,
  Darwin arm64.
- Consumed `@open-pencil/core`: `0.13.2`, integrity
  `sha512-/EIOMDUlpWtTneuwMj7DQfz39i6pOnPlQB5UIOIiEZZ2TLZIiRkKQQVeAsMjs3aFbyA/oYmc1pRhC8PEAl6Kow==`.
- G142 launch receipt: `PASS` for its recorded identity and launch metadata
  only; all three recorded tips are stale against current `origin/main`, and
  consuming effects remain `UNKNOWN`.
- Receipt: `.omx/ultragoal/launch-20260811T092336Z-r181/launch-receipt.json`
  (stale against current tips),
  SHA-256
  `4f0cef5d8dd9d37a5eac74467d9a29140c50aa07852f3422884fa88b364ead53`,
  `launchAttemptId=codex-019fa388-f893-7871-9c77-abe34a2d8fc6-attempt-181`.
- Seeded-defect run: `scenarioCount=0`, `outputCount=0`,
  `seededDefect=NOT_RUN`; timeout, leak, and cleanup: `UNKNOWN`.

## Acceptance boundary

No source contract, synthetic model record, Chromium run, static mobile
viewport, simulator, or executable presence substitutes for the requested
consuming effects. Every matrix row remains typed `UNKNOWN` until a named
surface produces a fresh identity-bound artifact from the current tip set. The
receipt proves only its prior launch identity, not current source identity,
Firefox, or other consuming effects.

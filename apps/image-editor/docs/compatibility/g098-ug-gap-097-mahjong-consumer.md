# G098 / UG-GAP-097 Performance, Memory, And Resilience Gate

Status: `UNKNOWN`

Scope: main-thread work, 100-layer and 512-layer interaction latency, optional
threshold-triggered scheduling, memory cleanup, and resilience on the Mahjong
image-editor consuming surface.

## Observed contracts

- `src/app/model/resilience-v1.ts` defines synthetic acceptance evaluators for
  20 WebGPU and WebGL2 restart cycles plus a 10-minute warmup and 60-minute
  soak. The evaluators require zero blank frames, silent failures, leaked
  workers, or leaked contexts; cap resident growth at 5% and at 64 MiB on D1 or
  32 MiB on M1; and cap progress gaps at 5 seconds.
- `src/app/model/resilience-v1.spec.ts` exercises those evaluators with seeded
  pass/fail records. This proves contract logic only, not browser, GPU,
  device, or process behavior.
- `docs/benchmarks/pixijs-stage0/report.md` and
  `docs/benchmarks/pixijs-gameplay/report.md` contain desktop Pixi/SVG
  measurements. Their workloads are gameplay or stage-0 parity workloads, not
  deterministic 100-layer and 512-layer image-editor workloads.
- No observed artifact proves the requested D1/M1 main-thread budget of
  `<=50 ms`, 100-layer p95 of `<=33.3 ms`, 512-layer p95 of `<=100 ms`, or
  threshold-triggered optional mechanism.

## Gate matrix

| Gate | Result | Exact boundary |
|---|---|---|
| Deterministic 100-layer workload | `UNKNOWN` | No named workload, seed, run count, p95 series, or consuming-surface artifact |
| Deterministic 512-layer workload | `UNKNOWN` | No named workload, seed, run count, p95 series, or consuming-surface artifact |
| D1/M1 main-thread tasks | `UNKNOWN` | No named D1/M1 runtime trace proving every task is `<=50 ms` |
| 100-layer p95 | `UNKNOWN` | Existing Pixi/SVG reports do not exercise this workload |
| 512-layer p95 | `UNKNOWN` | Existing Pixi/SVG reports do not exercise this workload |
| Threshold-triggered optional mechanism | `UNKNOWN` | No recorded threshold miss and no identity-bound activation trace |
| Memory boundary and cleanup | `UNKNOWN` | No process-memory series, frozen profile, repeated-cycle cleanup, or leak artifact |
| Resilience cycles and soak | `UNKNOWN` | Synthetic evaluators exist; no consuming-surface cycle or soak run observed |
| Browser/device/external editor effects | `UNKNOWN` | No physical device, external renderer, or named editor artifact observed |

## Exact tried list

1. Inspected `src/app/model/resilience-v1.ts` and
   `src/app/model/resilience-v1.spec.ts`.
2. Inspected the existing desktop benchmark reports and collector scripts.
3. Searched image-editor source, tests, scripts, and docs for the requested
   layer counts, p95 thresholds, main-thread budget, threshold activation,
   memory cleanup, and resilience evidence.
4. Confirmed the current checkout has no identity-bound G098 benchmark or
   consuming-surface artifact.

## Identity

- Mahjong checkout commit: `03a54cf9f56cdae91b427a8ae67f29c4a092e2c2`.
- Runtime: Node `v24.14.1`, npm `11.11.0`, Darwin arm64.
- Browser/device/external renderer identity: `UNKNOWN`.

## Verification

- Source contract review: `PASS`.
- Existing synthetic resilience tests: `PASS` by source review; fresh test
  execution is recorded separately by the owning verification lane.
- Requested performance, memory, cleanup, resilience, browser, device, and
  external-editor effects: `UNKNOWN`.

No status stronger than `UNKNOWN` is justified until a deterministic,
identity-bound workload produces p95 and memory/cleanup artifacts on the named
consuming surface.

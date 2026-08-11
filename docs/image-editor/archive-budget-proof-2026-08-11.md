# Archive budget proof

Date: 2026-08-11

## Identity

- Source base: `f988dc9747daeb08bcbfeda415db7360582f7263`
- Runtime: Bun `1.3.14` (`0d9b296a`)
- Delivery commit: recorded in the OMX task result after this artifact is committed

## Local proof

Focused archive, transaction, and PSD tests:

```text
CH5_RAW_TEST_OK=1 bun test \
  tests/engine/io/hostile-input.test.ts \
  tests/engine/io/transactional-worker.test.ts \
  tests/engine/io/formats/psd.test.ts

55 pass
0 fail
218 expect() calls
```

Observed effects:

- Declared file size rejects before `.fig`, JSON, or PSD payload reads.
- ZIP central-directory decoded totals reject before `unzipSync` allocation.
- Missing ZIP central-directory metadata rejects before `unzipSync` allocation.
- PSD decoded dimensions, expansion, and render-buffer limits reject before full payload allocation.
- PSD cancellation rejects before header reads and after a pending payload read, before publication.
- Transaction verification rejects an all-zero-byte output before commit.

## Seeded-defect proof

Two temporary defects were applied together, tested, then restored:

1. Replaced ZIP aggregate accounting with last-entry-only accounting.
2. Removed the all-zero-byte transaction output guard.

The focused run failed only the new regression checks:

```text
hostile-io-v1 rejects aggregate archive expansion before unzip allocation
host rejects zero-byte output before commit

21 pass
2 fail
SEEDED_DEFECT_PROOF=PASS expected_failure_exit=1
```

## Tooling boundary

`ch5 test` did not reach the test runner because the installed CLI rejected the
repository proof configuration with `proofs[].gates` as an unrecognized key.
The explicit raw-test escape was used after installing workspace dependencies.

Browser, GPU, named-device, and external-application behavior: `UNKNOWN`. No
claim in this proof upgrades those unobserved surfaces.

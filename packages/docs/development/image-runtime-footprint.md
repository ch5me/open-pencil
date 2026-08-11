---
title: Image Runtime Footprint
description: Runtime footprint contract and evidence boundaries for the image editor.
---

# Image Runtime Footprint

The image editor exposes a small, framework-neutral runtime footprint contract
for recording bundle, startup, loading, and cache evidence:

```ts
import {
  createImageRuntimeFootprintContract,
  validateImageRuntimeFootprintContract,
} from '@open-pencil/core'

const footprint = createImageRuntimeFootprintContract({
  frameworkNeutralCompositor: 'SUPPORTED',
})

validateImageRuntimeFootprintContract(footprint)
```

The contract is versioned as `image-runtime-footprint-v1`. Unmeasured values
must stay `UNKNOWN`; they are not estimates or implicit support claims.

For offline cache and runtime-version fields, the producer emits a typed
UNKNOWN proof until the browser consuming surface is observed:

```ts
import { createImageRuntimeFootprintUnknownProof } from '@open-pencil/core'

const proof = createImageRuntimeFootprintUnknownProof()
// proof.reason === 'consuming-surface-not-observed'
```

## Tracked values

- `gzipBudgetBytes` — measured compressed bundle size, or `UNKNOWN`.
- `lowEndStartupMs` — measured startup duration, or `UNKNOWN`.
- `lazyGpuLoading`, `lazyPsdLoading` — whether the corresponding code path is
  lazy-loaded.
- `frameworkNeutralCompositor` — framework-independent compositor support.
- `minimalGpuChunks` — whether the runtime keeps GPU code in minimal chunks.
- `offlineCache` — offline cache support.
- `runtimeVersionStrategy` — runtime versioning strategy support.

Explicit numeric values are validated: bundle size must be a non-negative safe
integer, and startup duration must be a finite non-negative number. Capability
fields accept only `SUPPORTED`, `UNSUPPORTED`, or `UNKNOWN`.

## Evidence boundary

The contract records evidence; it does not create it. A local test can prove
schema defaults and validation. It cannot prove low-end device startup,
browser rendering, GPU behavior, or compatibility with external editors. Keep
those fields `UNKNOWN` until the named consuming surface is measured.

Implementation:

```txt
packages/core/src/editor/image-footprint/
tests/engine/editor/image-footprint.test.ts
```

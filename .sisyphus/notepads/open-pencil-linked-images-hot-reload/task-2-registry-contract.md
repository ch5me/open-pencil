# Task 2 — Linked-Image Registry Contract

## Decision: Stable Synthetic IDs

- **ID format**: `linked-img-${nodeId}-${fillIndex}` (e.g., `linked-img-0:42-0`)
- **NOT content hashes** — content hash stored separately as `contentHash` field for cache-busting only
- **Fill type unchanged** — `Fill.imageHash` remains `string | undefined`, renderer contract preserved
- **Registry is a side-table** — lives outside `SceneGraph`, does not mutate `Fill` interface

## Registry Shape

```typescript
interface LinkedImageRecord {
  imageKey: string // stable synthetic id, used as fill.imageHash
  source: string // URL, path, or figma-remote handle
  sourceType: 'url' | 'path' | 'figma-remote'
  status: 'pending' | 'loading' | 'loaded' | 'error'
  contentHash: string | null // content hash of current bytes (not identity)
  error: string | null
}
```

## Renderer Contract Preserved

- `fill.imageHash` → `graph.images.get(hash)` → `Uint8Array` — unchanged
- `applyImageFill()` in `canvas/fills.ts:172-187` works as-is
- When linked bytes refresh, registry updates `graph.images` under same key → re-render triggers

## Files Created

- `packages/core/src/linked-images/registry.ts` — types + `LinkedImageRegistry` class
- `packages/core/src/linked-images/index.ts` — barrel exports
- `packages/core/src/index.ts` — wired exports into `@open-pencil/core`

## Key Functions

- `makeLinkedImageKey(nodeId, fillIndex)` → stable key
- `parseLinkedImageKey(key)` → `{ nodeId, fillIndex }` or null
- `LinkedImageRegistry.register()` → returns stable key for `fill.imageHash`
- `LinkedImageRegistry.updateStatus()` → track fetch lifecycle
- `LinkedImageRegistry.findByNode(nodeId)` → all linked images for a node

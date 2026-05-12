# Task 3: Renderer Invalidation

## Implementation

### renderer.ts

- Added `invalidateImage(hash: string): void` method before `destroyed` flag
- Pattern: `imageCache.get(hash)` → `img.delete()` → `imageCache.delete(hash)` → `requestRepaint()`
- Follows existing `destroy()` disposal pattern at lines 1140-1141

### create.ts

- Exposed as `invalidateImage: (hash: string) => _renderer?.invalidateImage(hash)`
- Placed alongside `storeImage` and `placeImageFiles` in clipboard section

## Verification

- Method calls `img.delete()` before map removal — no native memory leak
- Calls `requestRepaint()` after invalidation — triggers fresh decode on next paint
- Narrow blast radius: single key invalidation, no full renderer reset

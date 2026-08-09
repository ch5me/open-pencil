import type { ContentRevisionId } from "#core/editor/history/journal";

import type { AssetBinding, AssetGcResult, AssetId, AssetRevision } from "./types";

export interface AssetIdAllocator {
  assetId(): AssetId;
}

export function createAssetIdAllocator(
  randomUUID: () => string = () => crypto.randomUUID(),
): AssetIdAllocator {
  return { assetId: () => `asset:${randomUUID()}` };
}

export class AssetRegistry {
  private readonly bindings = new Map<AssetId, AssetBinding>();
  private readonly revisions = new Map<ContentRevisionId, AssetRevision>();

  constructor(private readonly ids: AssetIdAllocator = createAssetIdAllocator()) {}

  registerRevision(revision: AssetRevision): void {
    const existing = this.revisions.get(revision.revisionId);
    if (
      existing &&
      (existing.kind !== revision.kind ||
        existing.bytes.length !== revision.bytes.length ||
        !bytesEqual(existing.bytes, revision.bytes) ||
        JSON.stringify(existing.metadata) !== JSON.stringify(revision.metadata))
    ) {
      throw new Error(`immutable asset revision conflict: ${revision.revisionId}`);
    }
    this.revisions.set(revision.revisionId, {
      ...revision,
      metadata: structuredClone(revision.metadata),
      bytes: new Uint8Array(revision.bytes),
    });
  }

  createAsset(revisionId: ContentRevisionId): AssetBinding {
    this.requireRevision(revisionId);
    const binding = { assetId: this.ids.assetId(), revisionId };
    if (this.bindings.has(binding.assetId)) {
      throw new Error(`duplicate asset binding: ${binding.assetId}`);
    }
    this.bindings.set(binding.assetId, binding);
    return binding;
  }

  duplicateAsset(assetId: AssetId): AssetBinding {
    const source = this.requireBinding(assetId);
    return this.createAsset(source.revisionId);
  }

  retargetAsset(assetId: AssetId, revisionId: ContentRevisionId): AssetBinding {
    this.requireRevision(revisionId);
    this.requireBinding(assetId);
    const binding = { assetId, revisionId };
    this.bindings.set(assetId, binding);
    return binding;
  }

  deleteAsset(assetId: AssetId): void {
    if (!this.bindings.delete(assetId)) throw new Error(`missing asset binding: ${assetId}`);
  }

  getAsset(assetId: AssetId): AssetBinding | undefined {
    const binding = this.bindings.get(assetId);
    return binding && { ...binding };
  }

  getRevision(revisionId: ContentRevisionId): AssetRevision | undefined {
    const revision = this.revisions.get(revisionId);
    return revision && { ...revision, bytes: new Uint8Array(revision.bytes) };
  }

  validateReferences(assetIds: readonly AssetId[]): void {
    for (const assetId of assetIds) this.requireBinding(assetId);
  }

  collectGarbage(roots: Iterable<ContentRevisionId> = []): AssetGcResult {
    const retained = new Set(roots);
    for (const binding of this.bindings.values()) retained.add(binding.revisionId);
    const releasedRevisionIds: ContentRevisionId[] = [];
    let releasedBytes = 0;
    for (const [revisionId, revision] of this.revisions) {
      if (retained.has(revisionId)) continue;
      this.revisions.delete(revisionId);
      releasedRevisionIds.push(revisionId);
      releasedBytes += revision.bytes.byteLength;
    }
    return { releasedRevisionIds, releasedBytes };
  }

  assertConsistent(): void {
    for (const binding of this.bindings.values()) this.requireRevision(binding.revisionId);
  }

  reachableRevisionIds(): ReadonlySet<ContentRevisionId> {
    return new Set([...this.bindings.values()].map((binding) => binding.revisionId));
  }

  snapshot(): {
    readonly bindings: readonly AssetBinding[];
    readonly revisions: readonly AssetRevision[];
  } {
    return {
      bindings: [...this.bindings.values()].map((binding) => ({ ...binding })),
      revisions: [...this.revisions.values()].map((revision) => ({
        ...revision,
        metadata: structuredClone(revision.metadata),
        bytes: new Uint8Array(revision.bytes),
      })),
    };
  }

  private requireBinding(assetId: AssetId): AssetBinding {
    const binding = this.bindings.get(assetId);
    if (!binding) throw new Error(`missing asset binding: ${assetId}`);
    return binding;
  }

  private requireRevision(revisionId: ContentRevisionId): AssetRevision {
    const revision = this.revisions.get(revisionId);
    if (!revision) throw new Error(`missing content revision: ${revisionId}`);
    return revision;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

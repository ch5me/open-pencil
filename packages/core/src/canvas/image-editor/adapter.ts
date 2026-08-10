import type { CompositionPlan } from "#core/canvas/composition";
import type { AssetId } from "#core/editor/assets";

import {
  UnsupportedImageBackendError,
  type ImageRenderAdapter,
  type ImageRenderCommand,
  type ImageRenderFrame,
  type ImageRenderGap,
  type ImageRevisionResolver,
  type ImageTexture,
} from "./types";

export interface ImageRenderAdapterOptions {
  readonly backend?: string;
}

export function createImageRenderAdapter(
  options: ImageRenderAdapterOptions = {},
): ImageRenderAdapter {
  if (options.backend !== undefined && options.backend !== "skia") {
    throw new UnsupportedImageBackendError(`unsupported image backend: ${options.backend}`);
  }
  const dirtyAssets = new Set<AssetId>();
  const uploadedRevisions = new Map<AssetId, string>();

  return {
    backend: "skia",
    render(plan: CompositionPlan, resolve: ImageRevisionResolver): ImageRenderFrame {
      const commands: ImageRenderCommand[] = [];
      const textures: ImageTexture[] = [];
      const gaps: ImageRenderGap[] = [];
      for (const entry of plan.nodes.values()) {
        if (!entry.visible) continue;
        const assetId = entry.assetIds[0] ?? null;
        commands.push({
          nodeId: entry.nodeId,
          assetId,
          opacity: entry.inheritedOpacity,
          blendMode: entry.blendMode,
          clipped: entry.clipsContent,
          rotation: entry.rotation,
          maskType: entry.maskType,
          maskIsOutline: entry.maskIsOutline,
          adjustmentHooks: entry.adjustmentHooks,
        });
        if (assetId) {
          const binding = resolve.getAsset(assetId);
          if (!binding) {
            gaps.push({
              code: "missing-asset-binding",
              message: `asset binding is unavailable: ${assetId}`,
              assetId,
            });
            continue;
          }
          if (binding.assetId !== assetId) {
            gaps.push({
              code: "asset-binding-mismatch",
              message: `asset binding does not match requested asset: ${assetId}`,
              assetId,
            });
            continue;
          }
          const revision = resolve.getRevision(binding.revisionId);
          if (!revision) {
            gaps.push({
              code: "missing-asset-revision",
              message: `asset revision is unavailable: ${binding.revisionId}`,
              assetId,
            });
            continue;
          }
          const dirty =
            dirtyAssets.has(assetId) || uploadedRevisions.get(assetId) !== binding.revisionId;
          if (!dirty) {
            textures.push({
              assetId,
              revisionId: binding.revisionId,
              byteLength: revision.bytes.byteLength,
              dirty: false,
              uploaded: false,
            });
          } else {
            uploadedRevisions.set(assetId, binding.revisionId);
            dirtyAssets.delete(assetId);
            textures.push({
              assetId,
              revisionId: binding.revisionId,
              byteLength: revision.bytes.byteLength,
              dirty: false,
              uploaded: true,
            });
          }
        }
      }
      return { backend: "skia", commands, textures, gaps };
    },
    markDirty(assetId: AssetId): void {
      dirtyAssets.add(assetId);
    },
    restore(): void {
      dirtyAssets.clear();
      uploadedRevisions.clear();
    },
  };
}

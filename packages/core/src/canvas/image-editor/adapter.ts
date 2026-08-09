import type { CompositionPlan } from "#core/canvas/composition";
import type { AssetId } from "#core/editor/assets";

import {
  UnsupportedImageBackendError,
  type ImageRenderAdapter,
  type ImageRenderCommand,
  type ImageRenderFrame,
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
      for (const entry of plan.nodes.values()) {
        if (!entry.visible) continue;
        const assetId = null;
        commands.push({
          nodeId: entry.nodeId,
          assetId,
          opacity: entry.inheritedOpacity,
          blendMode: entry.blendMode,
          clipped: entry.clipsContent,
        });
        if (assetId) {
          const binding = resolve.getAsset(assetId);
          const revision = binding && resolve.getRevision(binding.revisionId);
          if (!binding || !revision) continue;
          const dirty =
            dirtyAssets.has(assetId) || uploadedRevisions.get(assetId) !== binding.revisionId;
          if (!dirty) {
            textures.push({
              assetId,
              revisionId: binding.revisionId,
              byteLength: revision.bytes.byteLength,
              dirty: false,
              uploaded: true,
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
      return { backend: "skia", commands, textures };
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

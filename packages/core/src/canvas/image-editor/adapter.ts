import type { CompositionPlan } from "#core/canvas/composition";
import type { AssetId } from "#core/editor/assets";

import {
  UnsupportedImageBackendError,
  type ImageRenderAdapter,
  type ImageRenderCommand,
  type ImageRenderFrame,
  type ImageRenderGap,
  type ImageDirtyRect,
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
  const dirtyRects = new Map<AssetId, ImageDirtyRect>();
  const uploadedRevisions = new Map<AssetId, string>();

  return {
    backend: "skia",
    render(plan: CompositionPlan, resolve: ImageRevisionResolver): ImageRenderFrame {
      const commands: ImageRenderCommand[] = [];
      const textures: ImageTexture[] = [];
      const gaps: ImageRenderGap[] = [];
      const emittedAssets = new Set<AssetId>();
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
          if (emittedAssets.has(assetId)) continue;
          emittedAssets.add(assetId);
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
            const revisionChanged = uploadedRevisions.get(assetId) !== binding.revisionId;
            const dirtyRect = dirtyRects.get(assetId);
            uploadedRevisions.set(assetId, binding.revisionId);
            dirtyAssets.delete(assetId);
            dirtyRects.delete(assetId);
            textures.push({
              assetId,
              revisionId: binding.revisionId,
              byteLength: revision.bytes.byteLength,
              dirty: true,
              uploaded: true,
              ...(dirtyRect && !revisionChanged
                ? { update: { kind: "partial" as const, dirtyRect } }
                : {}),
            });
          }
        }
      }
      return { backend: "skia", commands, textures, gaps };
    },
    markDirty(assetId: AssetId, dirtyRect?: ImageDirtyRect): void {
      if (dirtyRect) {
        validateDirtyRect(dirtyRect);
        const previous = dirtyRects.get(assetId);
        dirtyRects.set(assetId, previous ? unionDirtyRects(previous, dirtyRect) : { ...dirtyRect });
      }
      dirtyAssets.add(assetId);
    },
    restore(): void {
      dirtyAssets.clear();
      dirtyRects.clear();
      uploadedRevisions.clear();
    },
  };
}

function validateDirtyRect(rect: ImageDirtyRect): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError("invalid image texture dirty rectangle");
  }
}

function unionDirtyRects(left: ImageDirtyRect, right: ImageDirtyRect): ImageDirtyRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

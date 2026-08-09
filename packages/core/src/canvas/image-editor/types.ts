import type { CompositionPlan } from "#core/canvas/composition";
import type { AssetId, AssetRevision } from "#core/editor/assets";

export type ImageRenderBackend = "skia";

export class UnsupportedImageBackendError extends Error {
  readonly code = "unsupported-image-backend";
}

export interface ImageTexture {
  readonly assetId: AssetId;
  readonly revisionId: string;
  readonly byteLength: number;
  readonly dirty: boolean;
  readonly uploaded: boolean;
}

export interface ImageRenderCommand {
  readonly nodeId: string;
  readonly assetId: AssetId | null;
  readonly opacity: number;
  readonly blendMode: string;
  readonly clipped: boolean;
}

export interface ImageRenderFrame {
  readonly backend: ImageRenderBackend;
  readonly commands: readonly ImageRenderCommand[];
  readonly textures: readonly ImageTexture[];
}

export interface ImageRevisionResolver {
  getAsset(assetId: AssetId): { assetId: AssetId; revisionId: string } | undefined;
  getRevision(revisionId: string): AssetRevision | undefined;
}

export interface ImageRenderAdapter {
  readonly backend: ImageRenderBackend;
  render(plan: CompositionPlan, resolve: ImageRevisionResolver): ImageRenderFrame;
  markDirty(assetId: AssetId): void;
  restore(): void;
}

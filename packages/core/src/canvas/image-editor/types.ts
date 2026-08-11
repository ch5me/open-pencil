import type { CompositionPlan } from "#core/canvas/composition";
import type { AssetId, AssetRevision } from "#core/editor/assets";
import type { ImageTilePlan } from "./tiling";

export type ImageRenderBackend = "skia";
export type RendererResilienceState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface RendererResilienceContract {
  readonly version: "renderer-resilience-v1";
  readonly contextRestoration: RendererResilienceState;
  readonly resourceRecreation: RendererResilienceState;
  readonly lowMemoryProgressiveOpen: RendererResilienceState;
  readonly resolutionDowngrade: RendererResilienceState;
  readonly readbackTimeout: RendererResilienceState;
  readonly cancellation: RendererResilienceState;
  readonly corruptedImageIsolation: RendererResilienceState;
  readonly longSessionLeakGuard: RendererResilienceState;
}

export class RendererResilienceContractError extends Error {
  readonly code = "E_RENDERER_RESILIENCE_CONTRACT";
}

export function createRendererResilienceContract(
  overrides: Partial<Omit<RendererResilienceContract, "version">> = {},
): RendererResilienceContract {
  return {
    version: "renderer-resilience-v1",
    contextRestoration: "UNKNOWN",
    resourceRecreation: "UNKNOWN",
    lowMemoryProgressiveOpen: "UNKNOWN",
    resolutionDowngrade: "UNKNOWN",
    readbackTimeout: "UNKNOWN",
    cancellation: "UNKNOWN",
    corruptedImageIsolation: "UNKNOWN",
    longSessionLeakGuard: "UNKNOWN",
    ...overrides,
  };
}

export function validateRendererResilienceContract(
  contract: RendererResilienceContract,
): void {
  if (contract.version !== "renderer-resilience-v1") {
    throw new RendererResilienceContractError("invalid renderer resilience version");
  }
  const states = [
    contract.contextRestoration,
    contract.resourceRecreation,
    contract.lowMemoryProgressiveOpen,
    contract.resolutionDowngrade,
    contract.readbackTimeout,
    contract.cancellation,
    contract.corruptedImageIsolation,
    contract.longSessionLeakGuard,
  ];
  if (
    states.some(
      (state) => state !== "SUPPORTED" && state !== "UNKNOWN" && state !== "UNSUPPORTED",
    )
  ) {
    throw new RendererResilienceContractError("invalid renderer resilience state");
  }
}

export class UnsupportedImageBackendError extends Error {
  readonly code = "unsupported-image-backend";
}

export class ImageRenderContextLostError extends Error {
  readonly code = "image-render-context-lost";
}

export type ImageRenderGapCode =
  | "missing-asset-binding"
  | "missing-asset-revision"
  | "asset-binding-mismatch"
  | "asset-revision-mismatch"
  | "corrupted-image";

export interface ImageRenderGap {
  readonly code: ImageRenderGapCode;
  readonly message: string;
  readonly assetId: AssetId;
}

export interface ImageTexture {
  readonly assetId: AssetId;
  readonly revisionId: string;
  readonly byteLength: number;
  readonly dirty: boolean;
  readonly uploaded: boolean;
  readonly update?: ImageTextureUpdate;
  readonly tilePlan?: ImageTilePlan;
}

export interface ImageTextureUpdate {
  readonly kind: "partial";
  readonly dirtyRect: ImageDirtyRect;
}

export interface ImageDirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImageRenderCommand {
  readonly nodeId: string;
  readonly assetId: AssetId | null;
  readonly opacity: number;
  readonly blendMode: string;
  readonly clipped: boolean;
  readonly rotation: number;
  readonly maskType: string | null;
  readonly maskIsOutline: boolean;
  readonly adjustmentHooks: readonly string[];
}

export interface ImageRenderFrame {
  readonly backend: ImageRenderBackend;
  readonly commands: readonly ImageRenderCommand[];
  readonly textures: readonly ImageTexture[];
  readonly gaps: readonly ImageRenderGap[];
}

export interface ImageRevisionResolver {
  getAsset(assetId: AssetId): { assetId: AssetId; revisionId: string } | undefined;
  getRevision(revisionId: string): AssetRevision | undefined;
}

export interface ImageRenderAdapter {
  readonly backend: ImageRenderBackend;
  readonly resourceGeneration: number;
  render(plan: CompositionPlan, resolve: ImageRevisionResolver): ImageRenderFrame;
  markDirty(assetId: AssetId, dirtyRect?: ImageDirtyRect): void;
  loseContext(): void;
  restore(): void;
}

export const IMAGE_EDITOR_CONTRACT_SCHEMA = "ch5.open-pencil.image-editor.contract.v1";
export const AUTHORITY_MATRIX_HASH =
  "4e8bac3fc8b92bd0157f6ce24a73c5bbb6962012df87a001cbc36748582de784";
export const PATH_ALLOCATION_HASH =
  "ca831997c578c54aae5338e054cca75915ad8ecf56f1f92c3b704107a279fcdc";

export type ContentVersion = `content:${number}`;
export type ViewVersion = `view:${number}`;

export interface ImageEditorContract {
  schema: typeof IMAGE_EDITOR_CONTRACT_SCHEMA;
  contractVersion: "1.0.0";
  authorityMatrixHash: string;
  pathAllocationHash: string;
  transaction: {
    contentVersion: ContentVersion;
    viewVersion: ViewVersion;
    contentFields: readonly string[];
    viewFields: readonly string[];
    contentCas: "content-version-only";
    viewChangesAffectContent: false;
  };
  storage: {
    substrate: "indexeddb";
    database: "openpencil-image-editor-v1";
    objectStore: "records";
    stagedChunksOutsideContentTransaction: true;
    contentCommitAtomic: true;
    autosaveAckSeparateTransaction: true;
  };
  composition: {
    workingSpace: "document-primaries-linear";
    alpha: "premultiplied";
    quantization: "declared-by-backend";
    passThroughSemantics: "open-pencil-current-v1";
  };
  layerModel: {
    version: "layer-model-v1";
    migrationHash: string;
    invariants: readonly string[];
    capabilities: {
      passThroughGroups: true;
      declaredBlendModes: true;
      groupMasks: true;
      adjustmentMasks: true;
      linkedMasks: true;
      independentMasks: true;
      vectorMasks: true;
    };
    multiLayerTransaction: "old-or-new";
    unsupportedFields: readonly string[];
  };
  archive: {
    authorityId: "open-pencil-fig-kiwi";
    protocolVersion: "existing-version-preserving-fig-container";
    workerResult: "staged-output-manifest";
    durableCommitOwnedBy: "host";
  };
}

export interface WaveOneDependencyReceipt {
  authorityMatrixHash: string;
  pathAllocationHash: string;
}

export const IMAGE_EDITOR_CONTRACT: ImageEditorContract = {
  schema: IMAGE_EDITOR_CONTRACT_SCHEMA,
  contractVersion: "1.0.0",
  authorityMatrixHash: AUTHORITY_MATRIX_HASH,
  pathAllocationHash: PATH_ALLOCATION_HASH,
  transaction: {
    contentVersion: "content:1",
    viewVersion: "view:1",
    contentFields: ["document", "assets", "history", "logicalBindings"],
    viewFields: ["selection", "pan", "zoom", "tool"],
    contentCas: "content-version-only",
    viewChangesAffectContent: false,
  },
  storage: {
    substrate: "indexeddb",
    database: "openpencil-image-editor-v1",
    objectStore: "records",
    stagedChunksOutsideContentTransaction: true,
    contentCommitAtomic: true,
    autosaveAckSeparateTransaction: true,
  },
  composition: {
    workingSpace: "document-primaries-linear",
    alpha: "premultiplied",
    quantization: "declared-by-backend",
    passThroughSemantics: "open-pencil-current-v1",
  },
  layerModel: {
    version: "layer-model-v1",
    migrationHash: "9cf8ea8ce6d9d42bb7bc6f1f7c4f6b4b5c29c7d5e531db4d6b9b0a8f2f84c6a1",
    invariants: ["acyclic-parent-links", "no-dangling-mask-links", "stable-layer-order"],
    capabilities: {
      passThroughGroups: true,
      declaredBlendModes: true,
      groupMasks: true,
      adjustmentMasks: true,
      linkedMasks: true,
      independentMasks: true,
      vectorMasks: true,
    },
    multiLayerTransaction: "old-or-new",
    unsupportedFields: ["layer-link-color-label", "feathered-mask-density"],
  },
  archive: {
    authorityId: "open-pencil-fig-kiwi",
    protocolVersion: "existing-version-preserving-fig-container",
    workerResult: "staged-output-manifest",
    durableCommitOwnedBy: "host",
  },
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const object = value;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function assertDigest(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

export function assertWaveOneDependency(receipt: WaveOneDependencyReceipt): void {
  assertDigest(receipt.authorityMatrixHash, "authorityMatrixHash");
  assertDigest(receipt.pathAllocationHash, "pathAllocationHash");
  if (receipt.authorityMatrixHash !== AUTHORITY_MATRIX_HASH) {
    throw new Error("stale authorityMatrixHash");
  }
  if (receipt.pathAllocationHash !== PATH_ALLOCATION_HASH) {
    throw new Error("stale pathAllocationHash");
  }
}

export function canonicalContractJson(
  contract: ImageEditorContract = IMAGE_EDITOR_CONTRACT,
): string {
  return JSON.stringify(canonicalize(contract));
}

export async function computeContractHash(
  contract: ImageEditorContract = IMAGE_EDITOR_CONTRACT,
): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(canonicalContractJson(contract));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

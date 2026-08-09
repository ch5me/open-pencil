export const IMAGE_EDITOR_CONTRACT_SCHEMA = "ch5.open-pencil.image-editor.contract.v1";
export const AUTHORITY_MATRIX_HASH =
  "c9fa1e9e0167e69a73c0bc1534e7e4d089237b2063f1d9a0701510fe54477ae7";
export const PATH_ALLOCATION_HASH =
  "40e2dcedf8e530630d881594ea92e68fcc9b0d7fc09fe66dacaa3cf6ff1b3625";

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

export class ImageEditorContractError extends Error {
  readonly code = "E_IMAGE_EDITOR_CONTRACT";
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

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new ImageEditorContractError(`invalid ${label}`);
  }
}

function assertNonEmptyStrings(values: readonly string[], label: string): void {
  if (values.some((value) => !value.trim())) {
    throw new ImageEditorContractError(`${label} must contain non-empty strings`);
  }
}

export function validateImageEditorContract(contract: ImageEditorContract): void {
  assertEqual(contract.schema, IMAGE_EDITOR_CONTRACT_SCHEMA, "schema");
  assertEqual(contract.contractVersion, "1.0.0", "contractVersion");
  assertDigest(contract.authorityMatrixHash, "authorityMatrixHash");
  assertDigest(contract.pathAllocationHash, "pathAllocationHash");
  assertEqual(contract.authorityMatrixHash, AUTHORITY_MATRIX_HASH, "authorityMatrixHash");
  assertEqual(contract.pathAllocationHash, PATH_ALLOCATION_HASH, "pathAllocationHash");

  if (
    !/^content:\d+$/u.test(contract.transaction.contentVersion) ||
    !/^view:\d+$/u.test(contract.transaction.viewVersion)
  ) {
    throw new ImageEditorContractError("invalid transaction version");
  }
  assertNonEmptyStrings(contract.transaction.contentFields, "contentFields");
  assertNonEmptyStrings(contract.transaction.viewFields, "viewFields");
  const viewFields = new Set(contract.transaction.viewFields);
  if (contract.transaction.contentFields.some((field) => viewFields.has(field))) {
    throw new ImageEditorContractError("content and view fields must be disjoint");
  }
  assertEqual(contract.transaction.contentCas, "content-version-only", "contentCas");
  assertEqual(contract.transaction.viewChangesAffectContent, false, "viewChangesAffectContent");

  assertEqual(contract.storage.substrate, "indexeddb", "storage.substrate");
  assertEqual(contract.storage.database, "openpencil-image-editor-v1", "storage.database");
  assertEqual(contract.storage.objectStore, "records", "storage.objectStore");
  assertEqual(
    contract.storage.stagedChunksOutsideContentTransaction,
    true,
    "storage.stagedChunksOutsideContentTransaction",
  );
  assertEqual(contract.storage.contentCommitAtomic, true, "storage.contentCommitAtomic");
  assertEqual(
    contract.storage.autosaveAckSeparateTransaction,
    true,
    "storage.autosaveAckSeparateTransaction",
  );

  assertEqual(
    contract.composition.workingSpace,
    "document-primaries-linear",
    "composition.workingSpace",
  );
  assertEqual(contract.composition.alpha, "premultiplied", "composition.alpha");
  assertEqual(contract.composition.quantization, "declared-by-backend", "composition.quantization");
  assertEqual(
    contract.composition.passThroughSemantics,
    "open-pencil-current-v1",
    "composition.passThroughSemantics",
  );

  assertEqual(contract.layerModel.version, "layer-model-v1", "layerModel.version");
  assertDigest(contract.layerModel.migrationHash, "layerModel.migrationHash");
  assertNonEmptyStrings(contract.layerModel.invariants, "layerModel.invariants");
  assertEqual(
    contract.layerModel.multiLayerTransaction,
    "old-or-new",
    "layerModel.multiLayerTransaction",
  );
  assertNonEmptyStrings(contract.layerModel.unsupportedFields, "layerModel.unsupportedFields");
  for (const [name, enabled] of Object.entries(contract.layerModel.capabilities)) {
    assertEqual(enabled, true, `layerModel.capabilities.${name}`);
  }

  assertEqual(contract.archive.authorityId, "open-pencil-fig-kiwi", "archive.authorityId");
  assertEqual(
    contract.archive.protocolVersion,
    "existing-version-preserving-fig-container",
    "archive.protocolVersion",
  );
  assertEqual(contract.archive.workerResult, "staged-output-manifest", "archive.workerResult");
  assertEqual(contract.archive.durableCommitOwnedBy, "host", "archive.durableCommitOwnedBy");
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

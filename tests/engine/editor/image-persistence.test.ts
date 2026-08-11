/* oxlint-disable max-lines */

import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import {
  AtomicWorkingDocumentPersistence,
  createAcknowledgedWorkingDocumentIdentity,
  createPersistenceContractReceipt,
  createTerminationInjector,
  detachPngDataUrls,
  estimateJsonOverhead,
  migrateWorkingDocumentRecord,
  PersistenceConflictError,
  PersistenceContractError,
  PersistenceMigrationError,
  PersistenceQuotaError,
  PersistenceTerminationError,
  recoverWorkingDocument,
  validateDetachedWorkingDocument,
  validateWorkingDocumentRecord,
  verifyDetachedWorkingDocument,
  type DetachedWorkingDocument,
  type SaveWorkingDocumentOptions,
  type WorkingDocumentRecord,
} from "@open-pencil/core/editor";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const OTHER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAAF0RVh0eBGYI+kAAAAASUVORK5CYII=";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const OTHER_PNG_DATA_URL = `data:image/png;base64,${OTHER_PNG_BASE64}`;
const PRIOR_ROOT = "a".repeat(64);
const NEXT_ROOT = "b".repeat(64);
const THIRD_ROOT = "c".repeat(64);

function record(
  contentRootHash: string,
  contentSequence: number,
  payload: Readonly<Record<string, unknown>>,
): WorkingDocumentRecord {
  return {
    schema: "openpencil-working-document-v1",
    schemaVersion: 1,
    documentId: "doc:one",
    contentSequence,
    contentRootHash,
    payload,
    viewport: { panX: 10, panY: 20, zoom: 1.5 },
    selectionIds: ["layer:one"],
    historySequence: 3,
    commitState: "committed",
    updatedAt: contentSequence * 10,
  };
}

async function detached(
  contentRootHash: string,
  contentSequence: number,
): Promise<DetachedWorkingDocument> {
  return detachPngDataUrls(
    record(contentRootHash, contentSequence, {
      title: contentSequence === 1 ? "Prior" : "Next",
      image: contentSequence === 1 ? PNG_DATA_URL : OTHER_PNG_DATA_URL,
    }),
  );
}

function acknowledgement(workingDocument: WorkingDocumentRecord) {
  return createAcknowledgedWorkingDocumentIdentity(
    workingDocument.documentId,
    workingDocument.contentSequence,
    workingDocument.contentRootHash,
  );
}

function pngBytes(base64 = PNG_BASE64): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${bytes.toBase64()}`;
}

test("persistence-v1 detaches and deduplicates PNG bytes outside JSON", async () => {
  const result = await detachPngDataUrls(
    record(NEXT_ROOT, 2, {
      image: PNG_DATA_URL,
      nested: [{ duplicate: PNG_DATA_URL }],
    }),
  );
  const json = JSON.stringify(result.record);
  expect(json).not.toContain("data:image/png");
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0]?.bytes).toEqual(pngBytes());
  expect(json.match(/detached-binary-asset-v1/gu)).toHaveLength(2);
});

test("persistence-v1 recovers prior ACK or the complete new root over 100 terminations", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  let priorRecoveries = 0;
  let newRecoveries = 0;
  let mixedRoots = 0;

  for (let seed = 0; seed < 100; seed++) {
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: createTerminationInjector(seed, NEXT_ROOT),
    });
    await store.save(prior.record, prior.assets);
    await expect(
      store.save(next.record, next.assets, {
        expectedAcknowledgement: acknowledgement(prior.record),
      }),
    ).rejects.toBeInstanceOf(PersistenceTerminationError);

    const recovered = store.recover("doc:one");
    expect(recovered).toBeDefined();
    const recoveredRoot = recovered?.record.contentRootHash;
    expect([PRIOR_ROOT, NEXT_ROOT]).toContain(recoveredRoot);
    if (recoveredRoot === PRIOR_ROOT) priorRecoveries++;
    if (recoveredRoot === NEXT_ROOT) newRecoveries++;

    const expected = recoveredRoot === PRIOR_ROOT ? prior : next;
    if (
      JSON.stringify(recovered?.record) !== JSON.stringify(expected.record) ||
      JSON.stringify(recovered?.assets.map(({ reference }) => reference)) !==
        JSON.stringify(expected.assets.map(({ reference }) => reference)) ||
      recovered?.assets.some(
        (asset, index) =>
          asset.bytes.byteLength !== expected.assets[index]?.bytes.byteLength ||
          asset.bytes.some((byte, byteIndex) => byte !== expected.assets[index]?.bytes[byteIndex]),
      )
    ) {
      mixedRoots++;
    }
  }

  expect(priorRecoveries).toBe(75);
  expect(newRecoveries).toBe(25);
  expect(mixedRoots).toBe(0);
}, 30_000);

test("persistence-v1 first-save termination recovers nothing or one complete new root", async () => {
  const next = await detached(NEXT_ROOT, 1);
  for (let seed = 0; seed < 4; seed++) {
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: createTerminationInjector(seed, NEXT_ROOT),
    });
    await expect(store.save(next.record, next.assets)).rejects.toBeInstanceOf(
      PersistenceTerminationError,
    );
    const recovered = store.recover("doc:one");
    if (seed < 2) {
      expect(recovered).toBeUndefined();
    } else {
      expect(recovered).toEqual(next);
      expect(recovered?.record.commitState).toBe("committed");
    }
  }
});

test("persistence-v1 recovers the latest complete unacknowledged root", async () => {
  const first = await detached(PRIOR_ROOT, 1);
  const latest = await detached(NEXT_ROOT, 2);
  const store = new AtomicWorkingDocumentPersistence({
    onDurableBoundary: (boundary) => {
      if (boundary === "committed-record") {
        throw new PersistenceTerminationError(boundary, 0);
      }
    },
  });

  await expect(store.save(first.record, first.assets)).rejects.toBeInstanceOf(
    PersistenceTerminationError,
  );
  await expect(store.save(latest.record, latest.assets)).rejects.toBeInstanceOf(
    PersistenceTerminationError,
  );
  expect(store.recover("doc:one")).toEqual(latest);
});

test("persistence-v1 preserves ACK across same-content-root generation termination", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(PRIOR_ROOT, 2);
  for (let seed = 0; seed < 4; seed++) {
    let boundaryCount = 0;
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: (boundary) => {
        if (boundaryCount++ === 4 + seed) throw new PersistenceTerminationError(boundary, seed);
      },
    });
    await store.save(prior.record, prior.assets);
    await expect(
      store.save(next.record, next.assets, {
        expectedAcknowledgement: acknowledgement(prior.record),
      }),
    ).rejects.toBeInstanceOf(PersistenceTerminationError);
    expect(store.recover("doc:one")).toEqual(seed < 3 ? prior : next);
  }
});

test("persistence-v1 isolates equal content roots belonging to different documents", async () => {
  const first = await detached(PRIOR_ROOT, 1);
  const second = {
    record: { ...first.record, documentId: "doc:two" },
    assets: first.assets,
  };
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(first.record, first.assets);
  await store.save(second.record, second.assets);
  expect(store.recover("doc:one")?.record.documentId).toBe("doc:one");
  expect(store.recover("doc:two")?.record.documentId).toBe("doc:two");
});

test("persistence-v1 quota and migration failures preserve the acknowledged root", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const quotaStore = new AtomicWorkingDocumentPersistence({
    maxBytes:
      new TextEncoder().encode(JSON.stringify(prior.record)).byteLength +
      prior.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0),
  });
  await quotaStore.save(prior.record, prior.assets);
  const oversized = await detachPngDataUrls(
    record(NEXT_ROOT, 2, { image: PNG_DATA_URL, padding: "x".repeat(256) }),
  );
  await expect(
    quotaStore.save(oversized.record, oversized.assets, {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceQuotaError);
  expect(quotaStore.recover("doc:one")?.record.contentRootHash).toBe(PRIOR_ROOT);

  const migrationStore = new AtomicWorkingDocumentPersistence();
  await migrationStore.save(prior.record, prior.assets);
  await expect(
    migrationStore.save(record(NEXT_ROOT, 2, { image: PNG_DATA_URL }), [], {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(migrationStore.recover("doc:one")?.record.contentRootHash).toBe(PRIOR_ROOT);

  const digestMismatch = await detachPngDataUrls(
    record(NEXT_ROOT, 2, { image: OTHER_PNG_DATA_URL }),
  );
  if (digestMismatch.assets[0]) digestMismatch.assets[0].bytes[8] = 1;
  await expect(
    migrateWorkingDocumentRecord(digestMismatch.record, digestMismatch.assets),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  await expect(
    migrationStore.save(digestMismatch.record, digestMismatch.assets, {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(migrationStore.recover("doc:one")?.record.contentRootHash).toBe(PRIOR_ROOT);
  await expect(
    detachPngDataUrls(record(NEXT_ROOT, 2, { image: "data:image/png;base64,bm90LXBuZw==" })),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
});

test("public editor persistence rejects structurally corrupt PNGs before save or recovery", async () => {
  const valid = pngBytes();
  const signatureOnly = valid.slice(0, 8);
  const nonIhdrFirst = valid.slice();
  nonIhdrFirst.set([0x49, 0x44, 0x41, 0x54], 12);
  const invalidIhdrLength = valid.slice();
  invalidIhdrLength[11] = 12;
  const oversizedChunk = valid.slice();
  oversizedChunk.set([0xff, 0xff, 0xff, 0xff], 8);
  const trailingAfterIend = Uint8Array.from([...valid, 0]);
  const corruptPngs = [
    signatureOnly,
    nonIhdrFirst,
    invalidIhdrLength,
    oversizedChunk,
    trailingAfterIend,
  ];

  const prior = await detached(PRIOR_ROOT, 1);
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);
  for (const bytes of corruptPngs) {
    await expect(
      detachPngDataUrls(record(NEXT_ROOT, 2, { image: pngDataUrl(bytes) })),
    ).rejects.toBeInstanceOf(PersistenceMigrationError);
    const reference = {
      kind: "detached-binary-asset-v1" as const,
      assetId: `asset:${NEXT_ROOT}` as const,
      revisionId: `sha256:${NEXT_ROOT}` as const,
      mimeType: "image/png" as const,
      byteLength: bytes.byteLength,
    };
    await expect(
      store.save(record(NEXT_ROOT, 2, { image: reference }), [{ reference, bytes }], {
        expectedAcknowledgement: acknowledgement(prior.record),
      }),
    ).rejects.toBeInstanceOf(PersistenceMigrationError);
    expect(store.recover(prior.record.documentId)).toEqual(prior);
  }
});

test("persistence-v1 rejects surplus assets from mixed generations", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  const surplus = await detachPngDataUrls(record(THIRD_ROOT, 3, { image: OTHER_PNG_DATA_URL }));
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);
  await expect(
    store.save(next.record, [...next.assets, ...surplus.assets], {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  await expect(
    store.save(
      record(NEXT_ROOT, 2, {
        image: { ...next.assets[0]?.reference, hidden: surplus.assets[0]?.reference },
      }),
      next.assets,
      { expectedAcknowledgement: acknowledgement(prior.record) },
    ),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(store.recover("doc:one")).toEqual(prior);
});

test("persistence-v1 rejects stale sequences and stale-root CAS without regressing ACK", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  const third = await detachPngDataUrls(
    record(THIRD_ROOT, 3, { title: "Third", image: OTHER_PNG_DATA_URL }),
  );
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);
  await store.save(next.record, next.assets, {
    expectedAcknowledgement: acknowledgement(prior.record),
  });

  await expect(
    store.save(prior.record, prior.assets, {
      expectedAcknowledgement: acknowledgement(next.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceConflictError);
  await expect(
    store.save(third.record, third.assets, {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceConflictError);
  await expect(
    store.save(third.record, third.assets, {
      expectedAcknowledgement: { ...acknowledgement(next.record), rootKey: "wrong" },
    }),
  ).rejects.toBeInstanceOf(PersistenceContractError);
  await expect(
    store.save({ ...next.record, contentRootHash: THIRD_ROOT }, next.assets, {
      expectedAcknowledgement: acknowledgement(next.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceConflictError);
  expect(store.recover("doc:one")).toEqual(next);
});

test("persistence-v1 rejects same-root ABA against the acknowledged generation", async () => {
  const first = await detached(PRIOR_ROOT, 1);
  const middle = await detached(NEXT_ROOT, 2);
  const latest = await detached(PRIOR_ROOT, 3);
  const candidate = await detached(THIRD_ROOT, 4);
  const boundaries: string[] = [];
  const store = new AtomicWorkingDocumentPersistence({
    onDurableBoundary: (boundary) => boundaries.push(boundary),
  });
  await store.save(first.record, first.assets);
  await store.save(middle.record, middle.assets, {
    expectedAcknowledgement: acknowledgement(first.record),
  });
  await store.save(latest.record, latest.assets, {
    expectedAcknowledgement: acknowledgement(middle.record),
  });

  await expect(
    store.save(candidate.record, candidate.assets, {
      expectedAcknowledgement: acknowledgement(first.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceConflictError);
  const boundaryCount = boundaries.length;
  await expect(store.save(candidate.record, candidate.assets)).rejects.toBeInstanceOf(
    PersistenceConflictError,
  );
  await expect(
    store.save(candidate.record, candidate.assets, { expectedAcknowledgement: undefined }),
  ).rejects.toBeInstanceOf(PersistenceConflictError);
  expect(boundaries).toHaveLength(boundaryCount);
  expect(store.recover("doc:one")).toEqual(latest);
});

test("persistence-v1 exposes acknowledgement-only save options and requires full ACK", async () => {
  type HasRootOnlyOption = "expectedContentRootHash" extends keyof SaveWorkingDocumentOptions
    ? true
    : false;
  const hasRootOnlyOption: HasRootOnlyOption = false;
  expect(hasRootOnlyOption).toBeFalse();

  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);
  await expect(store.save(next.record, next.assets)).rejects.toBeInstanceOf(
    PersistenceConflictError,
  );
  expect(store.recover("doc:one")).toEqual(prior);
});

test("public editor save accepts exact options only", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  const invalidOptions = [
    { expectedContentRootHash: PRIOR_ROOT },
    { unknown: true },
    { expectedAcknowledgement: acknowledgement(prior.record), unknown: true },
    Object.defineProperty({}, "expectedAcknowledgement", {
      enumerable: true,
      get: () => acknowledgement(prior.record),
    }),
    new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError("save options proxy");
        },
      },
    ),
  ];

  for (const options of invalidOptions) {
    const store = new AtomicWorkingDocumentPersistence();
    await store.save(prior.record, prior.assets);
    await expect(
      Reflect.apply(store.save.bind(store), undefined, [next.record, next.assets, options]),
    ).rejects.toBeInstanceOf(PersistenceContractError);
    expect(store.recover(prior.record.documentId)).toEqual(prior);
  }
});

test("persistence-v1 rejects non-JSON payload representations before serialization", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);
  const sparse: unknown[] = [];
  sparse.length = 1;
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, 0, { enumerable: true, get: () => "value" });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalidValues: readonly unknown[] = [
    undefined,
    Number.NaN,
    -0,
    1n,
    Symbol("value"),
    () => "value",
    new Date(0),
    sparse,
    accessor,
    cyclic,
  ];

  for (const invalid of invalidValues) {
    await expect(store.save(record(NEXT_ROOT, 2, { invalid }), [])).rejects.toBeInstanceOf(
      PersistenceContractError,
    );
    expect(store.recover("doc:one")).toEqual(prior);
  }
});

test("persistence-v1 rejects non-JSON whole-record representations before serialization", async () => {
  const base = record(NEXT_ROOT, 1, {});
  const invalidRecords: WorkingDocumentRecord[] = [
    Object.assign({ ...base }, { extra: 1n }),
    Object.assign({ ...base }, { extra: undefined }),
    Object.assign({ ...base }, { extra: () => "value" }),
    Object.assign({ ...base }, { extra: Symbol("value") }),
  ];

  const sparseSelection = [...base.selectionIds];
  sparseSelection.length = 2;
  invalidRecords.push({ ...base, selectionIds: sparseSelection });

  const accessorSelection: string[] = [];
  Object.defineProperty(accessorSelection, 0, {
    enumerable: true,
    get: () => "layer:one",
  });
  accessorSelection.length = 1;
  invalidRecords.push({ ...base, selectionIds: accessorSelection });

  const prototypeSelection = [...base.selectionIds];
  Object.setPrototypeOf(prototypeSelection, null);
  invalidRecords.push({ ...base, selectionIds: prototypeSelection });

  for (const invalidRecord of invalidRecords) {
    await expect(
      new AtomicWorkingDocumentPersistence().save(invalidRecord, []),
    ).rejects.toBeInstanceOf(PersistenceContractError);
  }
});

test("public editor recovery rejects hostile record array shapes with typed errors", () => {
  const base = record(PRIOR_ROOT, 1, {});
  const sparse = [base];
  sparse.length = 2;
  const extraKey = [base];
  Reflect.set(extraKey, "extra", base);
  const accessorRecord = { ...base };
  Object.defineProperty(accessorRecord, "documentId", {
    enumerable: true,
    get: () => {
      throw new TypeError("record getter executed");
    },
  });
  const hostileArrays: readonly unknown[] = [
    null,
    1,
    {},
    sparse,
    extraKey,
    [null],
    [undefined],
    [1],
    [{ ...base, extra: true }],
    [accessorRecord],
  ];

  for (const hostile of hostileArrays) {
    expect(() =>
      Reflect.apply(recoverWorkingDocument, undefined, [
        hostile,
        base.documentId,
        acknowledgement(base),
      ]),
    ).toThrow(PersistenceContractError);
  }
});

test("public editor save and migration reject hostile asset array shapes with typed errors", async () => {
  const detachedDocument = await detached(PRIOR_ROOT, 1);
  const asset = detachedDocument.assets[0];
  const sparse = [asset];
  sparse.length = 2;
  const extraArrayKey = [asset];
  Reflect.set(extraArrayKey, "extra", asset);
  const accessorAsset = { ...asset };
  Object.defineProperty(accessorAsset, "bytes", {
    enumerable: true,
    get: () => {
      throw new TypeError("asset getter executed");
    },
  });
  const hostileArrays: readonly unknown[] = [
    null,
    1,
    {},
    sparse,
    extraArrayKey,
    [null],
    [undefined],
    [1],
    [{ reference: asset.reference }],
    [{ ...asset, extra: true }],
    [accessorAsset],
  ];

  for (const hostile of hostileArrays) {
    const store = new AtomicWorkingDocumentPersistence();
    await expect(
      Reflect.apply(store.save.bind(store), undefined, [detachedDocument.record, hostile]),
    ).rejects.toBeInstanceOf(PersistenceContractError);
    await expect(
      Reflect.apply(migrateWorkingDocumentRecord, undefined, [detachedDocument.record, hostile]),
    ).rejects.toBeInstanceOf(PersistenceContractError);
  }
  const store = new AtomicWorkingDocumentPersistence();
  await expect(
    Reflect.apply(store.save.bind(store), undefined, [detachedDocument.record, undefined]),
  ).rejects.toBeInstanceOf(PersistenceContractError);
  await expect(
    Reflect.apply(migrateWorkingDocumentRecord, undefined, [detachedDocument.record, undefined]),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
});

test("public editor save and migration reject corrupt exact-shape asset fields without TypeError", async () => {
  const detachedDocument = await detached(PRIOR_ROOT, 1);
  const asset = detachedDocument.assets[0];
  const accessorReference = { ...asset.reference };
  Object.defineProperty(accessorReference, "revisionId", {
    enumerable: true,
    get: () => {
      throw new TypeError("reference getter executed");
    },
  });
  const corruptAssets: readonly unknown[] = [
    [{ reference: null, bytes: asset.bytes }],
    [{ reference: asset.reference, bytes: null }],
    [{ reference: { ...asset.reference, extra: true }, bytes: asset.bytes }],
    [{ reference: accessorReference, bytes: asset.bytes }],
  ];

  for (const corrupt of corruptAssets) {
    const store = new AtomicWorkingDocumentPersistence();
    await expect(
      Reflect.apply(store.save.bind(store), undefined, [detachedDocument.record, corrupt]),
    ).rejects.toBeInstanceOf(PersistenceMigrationError);
    await expect(
      Reflect.apply(migrateWorkingDocumentRecord, undefined, [detachedDocument.record, corrupt]),
    ).rejects.toBeInstanceOf(PersistenceMigrationError);
  }
});

test("persistence-v1 rejects unknown JSON-safe record keys before PNG detachment", async () => {
  const base = record(NEXT_ROOT, 1, {});
  const embedded = { ...base };
  const benign = { ...base };
  Reflect.set(embedded, "extra", PNG_DATA_URL);
  Reflect.set(benign, "extra", { benign: true });
  await expect(detachPngDataUrls(embedded)).rejects.toBeInstanceOf(PersistenceContractError);
  await expect(detachPngDataUrls(benign)).rejects.toBeInstanceOf(PersistenceContractError);
});

test("public editor API rejects unknown viewport keys before PNG detachment", async () => {
  const embedded = record(NEXT_ROOT, 1, {});
  const benign = record(NEXT_ROOT, 1, {});
  Reflect.set(embedded.viewport, "extra", PNG_DATA_URL);
  Reflect.set(benign.viewport, "extra", true);

  await expect(detachPngDataUrls(embedded)).rejects.toBeInstanceOf(PersistenceContractError);
  await expect(detachPngDataUrls(benign)).rejects.toBeInstanceOf(PersistenceContractError);
});

test("persistence-v1 rejects PNG data URLs outside payload arrays", async () => {
  await expect(
    detachPngDataUrls({ ...record(NEXT_ROOT, 1, {}), selectionIds: [PNG_DATA_URL] }),
  ).rejects.toBeInstanceOf(PersistenceContractError);
});

test("persistence-v1 rejects PNG data URLs in nested payload keys", async () => {
  await expect(
    detachPngDataUrls(record(NEXT_ROOT, 1, { nested: { [PNG_DATA_URL]: true } })),
  ).rejects.toBeInstanceOf(PersistenceContractError);
});

test("persistence-v1 detaches caller and recovery asset buffers", async () => {
  const next = await detachPngDataUrls(record(NEXT_ROOT, 1, { image: OTHER_PNG_DATA_URL }));
  const store = new AtomicWorkingDocumentPersistence();
  const originalByte = next.assets[0]?.bytes[8];
  const pendingSave = store.save(next.record, next.assets);
  if (next.assets[0]) next.assets[0].bytes[8] = 1;
  await pendingSave;
  const firstRecovery = store.recover("doc:one");
  expect(firstRecovery?.assets[0]?.bytes[8]).toBe(originalByte);
  if (firstRecovery?.assets[0]) firstRecovery.assets[0].bytes[8] = 1;
  expect(store.recover("doc:one")?.assets[0]?.bytes[8]).toBe(originalByte);
});

test("persistence-v1 migration snapshots record and assets before async digest", async () => {
  const source = await detached(PRIOR_ROOT, 1);
  const originalRecord = structuredClone(source.record);
  const migration = migrateWorkingDocumentRecord(source.record, source.assets);

  Reflect.set(source.record, "documentId", "doc:mutated");
  Reflect.set(source.record.payload, "title", "Mutated");
  if (source.assets[0]) {
    source.assets[0].bytes[0] = 0;
    Reflect.set(source.assets[0].reference, "revisionId", `sha256:${THIRD_ROOT}`);
  }

  await expect(migration).resolves.toEqual(originalRecord);
});

test("public async persistence helpers snapshot complete inputs before digest awaits", async () => {
  const source = record(NEXT_ROOT, 2, {
    first: PNG_DATA_URL,
    second: OTHER_PNG_DATA_URL,
    title: "Original",
  });
  const original = structuredClone(source);
  const detachment = detachPngDataUrls(source);

  Reflect.set(source, "documentId", "doc:mutated");
  Reflect.set(source, "contentRootHash", THIRD_ROOT);
  Reflect.set(source.viewport, "panX", 999);
  Reflect.apply(Array.prototype.splice, source.selectionIds, [0]);
  Reflect.set(source.payload, "title", "Mutated");

  const detachedSnapshot = await detachment;
  expect(detachedSnapshot.record.documentId).toBe(original.documentId);
  expect(detachedSnapshot.record.contentRootHash).toBe(original.contentRootHash);
  expect(detachedSnapshot.record.viewport).toEqual(original.viewport);
  expect(detachedSnapshot.record.selectionIds).toEqual(original.selectionIds);
  expect(detachedSnapshot.record.payload.title).toBe("Original");

  const verification = verifyDetachedWorkingDocument(
    detachedSnapshot.record,
    detachedSnapshot.assets,
  );
  Reflect.set(detachedSnapshot.record, "documentId", "doc:changed-after-verify");
  if (detachedSnapshot.assets[0]) {
    Reflect.set(detachedSnapshot.assets[0].reference, "revisionId", `sha256:${THIRD_ROOT}`);
    detachedSnapshot.assets[0].bytes[0] = 0;
  }
  if (detachedSnapshot.assets[1]) detachedSnapshot.assets[1].bytes[1] = 0;
  await expect(verification).resolves.toBeUndefined();
});

test("public save snapshots acknowledgement options before digest awaits", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  const expectedAcknowledgement = acknowledgement(prior.record);
  const options = { expectedAcknowledgement };
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);

  const save = store.save(next.record, next.assets, options);
  Reflect.set(expectedAcknowledgement, "contentRootHash", THIRD_ROOT);
  Reflect.set(options, "expectedAcknowledgement", acknowledgement(next.record));

  await expect(save).resolves.toBeUndefined();
  expect(store.recover(prior.record.documentId)).toEqual(next);
});

test("public persistence boundaries normalize access traps without double-wrapping", async () => {
  const base = record(PRIOR_ROOT, 1, {});
  const rawTrap = () => {
    throw new TypeError("hostile public getter");
  };
  const hostileRecord = new Proxy(base, { ownKeys: rawTrap });
  const hostilePayload = new Proxy({}, { ownKeys: rawTrap });
  const hostileRecords = new Proxy([base], { ownKeys: rawTrap });
  const hostileAssets = new Proxy([], { ownKeys: rawTrap });
  const hostileReceipt = new Proxy({}, { ownKeys: rawTrap });
  const hostileSaveOptions = Object.defineProperty({}, "expectedAcknowledgement", {
    enumerable: true,
    get: rawTrap,
  });

  const syncCalls = [
    () => validateWorkingDocumentRecord(hostileRecord),
    () => validateDetachedWorkingDocument(base, hostileAssets),
    () => recoverWorkingDocument(hostileRecords, base.documentId, acknowledgement(base)),
    () => estimateJsonOverhead(hostilePayload),
    () => createPersistenceContractReceipt(hostileReceipt),
  ];
  for (const call of syncCalls) {
    try {
      call();
      throw new Error("expected persistence boundary failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ code: expect.stringMatching(/^E_IMAGE_PERSISTENCE_/u) });
    }
  }

  await expect(detachPngDataUrls(hostileRecord)).rejects.toMatchObject({
    code: "E_IMAGE_PERSISTENCE_CONTRACT",
  });
  await expect(
    Reflect.apply(verifyDetachedWorkingDocument, undefined, [base, hostileAssets]),
  ).rejects.toMatchObject({ code: "E_IMAGE_PERSISTENCE_MIGRATION" });
  const hostileOptionsStore = new AtomicWorkingDocumentPersistence();
  await expect(hostileOptionsStore.save(base, [], hostileSaveOptions)).rejects.toMatchObject({
    code: "E_IMAGE_PERSISTENCE_CONTRACT",
  });
  expect(() =>
    Reflect.construct(AtomicWorkingDocumentPersistence, [{ onBoundary: "not-a-function" }]),
  ).toThrow(PersistenceContractError);

  const typed = new PersistenceContractError("preserve identity");
  const typedTrap = new Proxy(
    {},
    {
      ownKeys() {
        throw typed;
      },
    },
  );
  try {
    estimateJsonOverhead(typedTrap);
    throw new Error("expected typed persistence failure");
  } catch (error) {
    expect(error).toBe(typed);
  }

  const asyncTyped = new PersistenceConflictError("preserve async identity");
  const asyncTypedRecord = new Proxy(base, {
    ownKeys() {
      throw asyncTyped;
    },
  });
  await expect(detachPngDataUrls(asyncTypedRecord)).rejects.toBe(asyncTyped);

  const saveTyped = new PersistenceQuotaError("preserve save identity");
  const typedSaveOptions = new Proxy(
    {},
    {
      ownKeys() {
        throw saveTyped;
      },
    },
  );
  await expect(
    new AtomicWorkingDocumentPersistence().save(base, [], typedSaveOptions),
  ).rejects.toBe(saveTyped);
});

test("public persistence normalization preserves specialized error identity and codes", () => {
  const errors = [
    new PersistenceContractError("contract"),
    new PersistenceQuotaError("quota"),
    new PersistenceMigrationError("migration"),
    new PersistenceConflictError("conflict"),
    new PersistenceTerminationError("asset", 0),
  ];

  for (const typed of errors) {
    expect(typed).toBeInstanceOf(PersistenceContractError);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw typed;
        },
      },
    );
    try {
      Reflect.apply(createPersistenceContractReceipt, undefined, [hostile]);
      throw new Error("expected typed persistence failure");
    } catch (error) {
      expect(error).toBe(typed);
      expect(error).toMatchObject({ code: typed.code });
    }
  }
});

test("public persistence receipt accepts exact state overrides only", () => {
  expect(
    createPersistenceContractReceipt({
      atomicSave: "SUPPORTED",
      crashRecovery: "UNSUPPORTED",
    }),
  ).toMatchObject({
    version: "persistence-v1",
    atomicSave: "SUPPORTED",
    crashRecovery: "UNSUPPORTED",
  });

  const invalidOverrides = [
    { version: "persistence-v1" },
    { jsonOverheadBytes: 1 },
    { unknown: "SUPPORTED" },
    { atomicSave: "YES" },
    Object.defineProperty({}, "atomicSave", {
      enumerable: true,
      get: () => "SUPPORTED",
    }),
    { [Symbol("atomicSave")]: "SUPPORTED" },
    new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError("receipt proxy");
        },
      },
    ),
  ];
  for (const overrides of invalidOverrides) {
    expect(() => Reflect.apply(createPersistenceContractReceipt, undefined, [overrides])).toThrow(
      PersistenceContractError,
    );
  }
});

test("persistence-v1 rejects unsupported image data URLs everywhere persisted", async () => {
  const jpegDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const svgDataUrl = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";

  await expect(
    detachPngDataUrls(record(NEXT_ROOT, 1, { image: jpegDataUrl })),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  await expect(
    new AtomicWorkingDocumentPersistence().save(record(NEXT_ROOT, 1, { image: svgDataUrl }), []),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  await expect(
    detachPngDataUrls({ ...record(NEXT_ROOT, 1, {}), selectionIds: [jpegDataUrl] }),
  ).rejects.toBeInstanceOf(PersistenceContractError);
});

test("persistence-v1 accepts cross-realm Uint8Array and rejects other views", async () => {
  const source = await detached(PRIOR_ROOT, 1);
  const bytes = runInNewContext("Uint8Array.from(bytes)", {
    bytes: [...pngBytes()],
  }) as Uint8Array;
  expect(bytes instanceof Uint8Array).toBeFalse();

  const crossRealmAssets = [{ reference: source.assets[0]?.reference, bytes }];
  await expect(migrateWorkingDocumentRecord(source.record, crossRealmAssets)).resolves.toEqual(
    source.record,
  );

  for (const invalidBytes of [
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
  ]) {
    await expect(
      Reflect.apply(migrateWorkingDocumentRecord, undefined, [
        source.record,
        [{ reference: source.assets[0]?.reference, bytes: invalidBytes }],
      ]),
    ).rejects.toBeInstanceOf(PersistenceMigrationError);
  }
});

test("public editor API wraps detached asset buffers before persistence mutation", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const candidate = await detached(NEXT_ROOT, 2);
  const bytes = candidate.assets[0]?.bytes;
  expect(bytes).toBeDefined();
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);

  await expect(
    migrateWorkingDocumentRecord(candidate.record, candidate.assets),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  await expect(
    store.save(candidate.record, candidate.assets, {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(store.recover(prior.record.documentId)).toEqual(prior);
});

test("public editor API wraps hostile byte proxies before persistence mutation", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const candidate = await detached(NEXT_ROOT, 2);
  const bytes = new Proxy(candidate.assets[0]?.bytes ?? new Uint8Array(), {
    getPrototypeOf() {
      throw new Error("hostile byte proxy");
    },
  });
  const assets = [{ reference: candidate.assets[0]?.reference, bytes }];
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);

  await expect(
    Reflect.apply(migrateWorkingDocumentRecord, undefined, [candidate.record, assets]),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  await expect(
    store.save(candidate.record, assets, {
      expectedAcknowledgement: acknowledgement(prior.record),
    }),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(store.recover(prior.record.documentId)).toEqual(prior);
});

test("persistence-v1 preserves existing record and receipt APIs", () => {
  const baseRecord = record(PRIOR_ROOT, 1, { title: "Draft", assets: ["asset:one"] });
  expect(() => validateWorkingDocumentRecord(baseRecord)).not.toThrow();
  const receipt = createPersistenceContractReceipt(
    {
      atomicSave: "SUPPORTED",
      deduplication: "SUPPORTED",
      schemaMigration: "SUPPORTED",
      crashRecovery: "SUPPORTED",
    },
    estimateJsonOverhead(baseRecord.payload),
  );
  expect(receipt.version).toBe("persistence-v1");
  expect(receipt.jsonOverheadBytes).toBeGreaterThanOrEqual(0);

  const staged = { ...baseRecord, contentSequence: 5, commitState: "staged" as const };
  const staleCommitted = {
    ...baseRecord,
    contentSequence: 2,
    payload: { title: "Stale" },
    updatedAt: 10,
  };
  const committed = {
    ...baseRecord,
    contentSequence: 2,
    payload: { title: "Latest" },
    updatedAt: 20,
  };
  expect(
    recoverWorkingDocument(
      [staged, baseRecord, staleCommitted, committed],
      "doc:one",
      acknowledgement(committed),
    )?.payload,
  ).toEqual({ title: "Latest" });
  expect(
    recoverWorkingDocument(
      [baseRecord],
      "doc:missing",
      createAcknowledgedWorkingDocumentIdentity(
        "doc:missing",
        baseRecord.contentSequence,
        baseRecord.contentRootHash,
      ),
    ),
  ).toBeUndefined();
  const sourceSelection = ["layer:one"];
  const recovered = recoverWorkingDocument(
    [{ ...baseRecord, selectionIds: sourceSelection }],
    "doc:one",
    acknowledgement(baseRecord),
  );
  sourceSelection.splice(0);
  expect(recovered?.selectionIds).toEqual(["layer:one"]);
  expect(() =>
    validateWorkingDocumentRecord({ ...baseRecord, viewport: { ...baseRecord.viewport, zoom: 0 } }),
  ).toThrow(PersistenceContractError);
});

test("public recovery rejects empty and hostile document identifiers", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(prior.record, prior.assets);
  const invalidDocumentIds = [
    "",
    null,
    undefined,
    1,
    {},
    new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new TypeError("documentId proxy");
        },
      },
    ),
  ];

  for (const documentId of invalidDocumentIds) {
    expect(() => Reflect.apply(store.recover.bind(store), undefined, [documentId])).toThrow(
      PersistenceContractError,
    );
    expect(() =>
      Reflect.apply(recoverWorkingDocument, undefined, [
        [prior.record],
        documentId,
        acknowledgement(prior.record),
      ]),
    ).toThrow(PersistenceContractError);
  }
  expect(store.recover(prior.record.documentId)).toEqual(prior);
});

test("persistence-v1 record recovery ignores unacknowledged embedded data URLs", () => {
  const acknowledged = record(PRIOR_ROOT, 1, { title: "A1" });
  const unacknowledged = record(NEXT_ROOT, 2, { image: PNG_DATA_URL, title: "B2" });

  expect(
    recoverWorkingDocument(
      [acknowledged, unacknowledged],
      acknowledged.documentId,
      acknowledgement(acknowledged),
    ),
  ).toEqual(acknowledged);
  expect(() =>
    recoverWorkingDocument(
      [unacknowledged],
      unacknowledged.documentId,
      acknowledgement(unacknowledged),
    ),
  ).toThrow(PersistenceMigrationError);
});

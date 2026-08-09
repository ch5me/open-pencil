import type { ContentMaskHash, ContentSnapshot, ContentSnapshotTransition } from "./types";

function assertHash(value: string, label: string): void {
  if (!/^(?:sha256:)?[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
}

function cloneSnapshot(snapshot: ContentSnapshot): ContentSnapshot {
  assertHash(snapshot.contentRootHash, "contentRootHash");
  const maskHashes = snapshot.maskHashes
    .map((mask) => {
      if (!mask.maskId) throw new Error("maskId must not be empty");
      assertHash(mask.byteHash, `mask ${mask.maskId} byteHash`);
      return { maskId: mask.maskId, byteHash: mask.byteHash };
    })
    .sort((left, right) => left.maskId.localeCompare(right.maskId));
  for (let index = 1; index < maskHashes.length; index += 1) {
    if (maskHashes[index - 1]?.maskId === maskHashes[index]?.maskId) {
      throw new Error(`duplicate maskId: ${maskHashes[index]?.maskId}`);
    }
  }
  return { contentRootHash: snapshot.contentRootHash, maskHashes };
}

export function createContentSnapshot(
  contentRootHash: string,
  maskHashes: readonly ContentMaskHash[] = [],
): ContentSnapshot {
  return cloneSnapshot({ contentRootHash, maskHashes });
}

export function applyContentSnapshotTransition(
  current: ContentSnapshot,
  transition: ContentSnapshotTransition,
  direction: "undo" | "redo",
): ContentSnapshot {
  const expected = direction === "undo" ? transition.next : transition.base;
  const target = direction === "undo" ? transition.base : transition.next;
  const normalizedCurrent = cloneSnapshot(current);
  const normalizedExpected = cloneSnapshot(expected);
  if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${direction} snapshot base mismatch`);
  }
  return cloneSnapshot(target);
}

export type DeferredCapabilityState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export type DeferredCapabilityKey =
  | "raster-advanced"
  | "selection-advanced"
  | "vector-advanced"
  | "typography-advanced"
  | "color-hdr"
  | "smart-object"
  | "layer-style"
  | "plugin-interop"
  | "print-format-collaboration";

export interface DeferredCapabilityReceipt {
  readonly key: DeferredCapabilityKey;
  readonly state: DeferredCapabilityState;
  readonly trigger: string;
  readonly evidence: string;
}

export interface ImageDeferredCapabilitiesContract {
  readonly version: "image-deferred-capabilities-v1";
  readonly receipts: readonly DeferredCapabilityReceipt[];
}

export class ImageDeferredCapabilityError extends Error {
  readonly code = "E_IMAGE_DEFERRED_CAPABILITY";
}

export function createImageDeferredCapabilitiesContract(
  receipts: readonly DeferredCapabilityReceipt[] = [],
): ImageDeferredCapabilitiesContract {
  return { version: "image-deferred-capabilities-v1", receipts: [...receipts] };
}

export function validateImageDeferredCapabilitiesContract(
  contract: ImageDeferredCapabilitiesContract,
): void {
  if (contract.version !== "image-deferred-capabilities-v1") {
    throw new ImageDeferredCapabilityError("invalid deferred capability version");
  }
  const keys = new Set<DeferredCapabilityKey>();
  for (const receipt of contract.receipts) {
    if (keys.has(receipt.key)) {
      throw new ImageDeferredCapabilityError(`duplicate deferred capability: ${receipt.key}`);
    }
    keys.add(receipt.key);
    if (
      !receipt.trigger.trim() ||
      !receipt.evidence.trim() ||
      !["SUPPORTED", "UNKNOWN", "UNSUPPORTED"].includes(receipt.state)
    ) {
      throw new ImageDeferredCapabilityError("deferred capability needs trigger and evidence");
    }
  }
}

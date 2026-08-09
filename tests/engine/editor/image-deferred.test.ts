import { expect, test } from "bun:test";

import {
  createImageDeferredCapabilitiesContract,
  ImageDeferredCapabilityError,
  validateImageDeferredCapabilitiesContract,
  type DeferredCapabilityReceipt,
} from "#core/editor/image-deferred";

const deferred: readonly DeferredCapabilityReceipt[] = [
  {
    key: "raster-advanced",
    state: "UNKNOWN",
    trigger: "Implement audited non-destructive raster stack",
    evidence: "No complete current authority observed",
  },
  {
    key: "color-hdr",
    state: "UNSUPPORTED",
    trigger: "Add HDR working-space contract and backend",
    evidence: "Current composition contract is SDR-only",
  },
  {
    key: "print-format-collaboration",
    state: "UNKNOWN",
    trigger: "Complete print/export/collaboration acceptance corpus",
    evidence: "Real device and hosted proof absent",
  },
];

test("image-deferred-capabilities-v1 preserves explicit triggers and states", () => {
  const contract = createImageDeferredCapabilitiesContract(deferred);
  expect(() => validateImageDeferredCapabilitiesContract(contract)).not.toThrow();
  expect(contract.receipts[0]?.trigger).toContain("raster");
  expect(contract.receipts[1]?.state).toBe("UNSUPPORTED");
});

test("image-deferred-capabilities-v1 rejects duplicate keys or empty triggers", () => {
  const contract = createImageDeferredCapabilitiesContract(deferred);
  expect(() =>
    validateImageDeferredCapabilitiesContract({
      ...contract,
      receipts: [...deferred, deferred[0] as DeferredCapabilityReceipt],
    }),
  ).toThrow(ImageDeferredCapabilityError);
  expect(() =>
    validateImageDeferredCapabilitiesContract({
      ...contract,
      receipts: [{ ...deferred[0], trigger: "" }],
    }),
  ).toThrow("trigger and evidence");
});

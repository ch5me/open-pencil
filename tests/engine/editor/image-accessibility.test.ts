import { expect, test } from "bun:test";

import {
  createImageAccessibilityContract,
  ImageAccessibilityContractError,
  validateImageAccessibilityContract,
} from "#core/editor/image-accessibility";

test("image-accessibility-v1 keeps browser/device proof UNKNOWN and names transform handles", () => {
  const contract = createImageAccessibilityContract({
    keyboardOnly: "SUPPORTED",
    maskNonPointerAlternatives: "SUPPORTED",
    transformHandles: [
      {
        handleId: "bottom-right",
        accessibleName: "Resize bottom right",
        stateDescription: "Width 100, height 80",
        keyboardAdjustable: true,
      },
    ],
  });
  expect(() => validateImageAccessibilityContract(contract)).not.toThrow();
  expect(contract.screenReader).toBe("UNKNOWN");
  expect(contract.forcedColors).toBe("UNKNOWN");
  expect(contract.transformHandles[0]?.accessibleName).toBe("Resize bottom right");
});

test("image-accessibility-v1 rejects malformed transform handle metadata", () => {
  const contract = createImageAccessibilityContract();
  expect(() =>
    validateImageAccessibilityContract({
      ...contract,
      transformHandles: [
        {
          handleId: "",
          accessibleName: "Resize",
          stateDescription: "Ready",
          keyboardAdjustable: true,
        },
      ],
    }),
  ).toThrow(ImageAccessibilityContractError);
});

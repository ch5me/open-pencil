export type AccessibilityState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface TransformHandleAccessibility {
  readonly handleId: string;
  readonly accessibleName: string;
  readonly stateDescription: string;
  readonly keyboardAdjustable: boolean;
}

export interface ImageAccessibilityContract {
  readonly version: "image-accessibility-v1";
  readonly keyboardOnly: AccessibilityState;
  readonly screenReader: AccessibilityState;
  readonly tabSemantics: AccessibilityState;
  readonly maskNonPointerAlternatives: AccessibilityState;
  readonly focusOrder: AccessibilityState;
  readonly focusRestoration: AccessibilityState;
  readonly highContrast: AccessibilityState;
  readonly forcedColors: AccessibilityState;
  readonly reducedMotion: AccessibilityState;
  readonly transformHandles: readonly TransformHandleAccessibility[];
}

export class ImageAccessibilityContractError extends Error {
  readonly code = "E_IMAGE_ACCESSIBILITY_CONTRACT";
}

export function createImageAccessibilityContract(
  overrides: Partial<Omit<ImageAccessibilityContract, "version">> = {},
): ImageAccessibilityContract {
  return {
    version: "image-accessibility-v1",
    keyboardOnly: "UNKNOWN",
    screenReader: "UNKNOWN",
    tabSemantics: "UNKNOWN",
    maskNonPointerAlternatives: "UNKNOWN",
    focusOrder: "UNKNOWN",
    focusRestoration: "UNKNOWN",
    highContrast: "UNKNOWN",
    forcedColors: "UNKNOWN",
    reducedMotion: "UNKNOWN",
    transformHandles: [],
    ...overrides,
  };
}

export function validateImageAccessibilityContract(
  contract: ImageAccessibilityContract,
): void {
  if (contract.version !== "image-accessibility-v1") {
    throw new ImageAccessibilityContractError("invalid accessibility version");
  }
  const states = [
    contract.keyboardOnly,
    contract.screenReader,
    contract.tabSemantics,
    contract.maskNonPointerAlternatives,
    contract.focusOrder,
    contract.focusRestoration,
    contract.highContrast,
    contract.forcedColors,
    contract.reducedMotion,
  ];
  if (
    states.some(
      (state) => state !== "SUPPORTED" && state !== "UNKNOWN" && state !== "UNSUPPORTED",
    )
  ) {
    throw new ImageAccessibilityContractError("invalid accessibility state");
  }
  for (const handle of contract.transformHandles) {
    if (
      !handle.handleId ||
      !handle.accessibleName ||
      !handle.stateDescription ||
      typeof handle.keyboardAdjustable !== "boolean"
    ) {
      throw new ImageAccessibilityContractError("invalid transform handle accessibility");
    }
  }
}

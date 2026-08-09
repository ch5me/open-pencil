import { expect, test } from "bun:test";

import {
  COMPOSITION_COLOR_CONTRACT,
  COMPOSITION_COLOR_CONTRACT_VERSION,
} from "#core/color/composition";

test("composition color contract uses document-linear premultiplied semantics", () => {
  expect(COMPOSITION_COLOR_CONTRACT.version).toBe(COMPOSITION_COLOR_CONTRACT_VERSION);
  expect(COMPOSITION_COLOR_CONTRACT.workingSpace).toBe("document-primaries-linear");
  expect(COMPOSITION_COLOR_CONTRACT.alpha).toBe("premultiplied");
});

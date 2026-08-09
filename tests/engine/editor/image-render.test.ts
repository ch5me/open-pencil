import { expect, test } from "bun:test";

import { createImageRenderAdapter, UnsupportedImageBackendError } from "#core/canvas/image-editor";

test("image render adapter rejects unsupported backends and restores texture state", () => {
  expect(() => createImageRenderAdapter({ backend: "webgpu" })).toThrow(
    UnsupportedImageBackendError,
  );
  const adapter = createImageRenderAdapter();
  adapter.markDirty("asset:image");
  adapter.restore();
  expect(adapter.backend).toBe("skia");
});

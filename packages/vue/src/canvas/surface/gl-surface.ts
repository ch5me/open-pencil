import { IS_BROWSER } from "@open-pencil/core/constants";
import type { Editor } from "@open-pencil/core/editor";
import type { CanvasKit, Surface } from "canvaskit-wasm";

import type { UseCanvasOptions } from "#vue/canvas/surface/types";

type GLContext = NonNullable<ReturnType<CanvasKit["MakeGrContext"]>>;

export interface CanvasGLContext {
  readonly grContext: GLContext;
  delete(): void;
}

export function sizeCanvas(canvas: HTMLCanvasElement, editor: Editor) {
  const dpr = IS_BROWSER ? window.devicePixelRatio || 1 : 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  if ("setViewportSize" in editor && typeof editor.setViewportSize === "function") {
    editor.setViewportSize(canvas.clientWidth, canvas.clientHeight);
  }
}

export function makeGLSurface(
  ck: CanvasKit,
  canvas: HTMLCanvasElement,
  editor: Editor,
  options: UseCanvasOptions | undefined,
  glContext: CanvasGLContext | null,
): {
  surface: Surface | null;
  glContext: CanvasGLContext | null;
  webglContext: WebGL2RenderingContext | null;
  contextCreated: boolean;
  contextDeleted: boolean;
} {
  const webglContext = canvas.getContext("webgl2", {
    preserveDrawingBuffer: options?.preserveDrawingBuffer ?? false,
  });
  if (!webglContext) {
    return {
      surface: null,
      glContext,
      webglContext: null,
      contextCreated: false,
      contextDeleted: false,
    };
  }

  let context = glContext;
  let ownsContext = false;
  if (!context) {
    const glAttrs = options?.preserveDrawingBuffer ? { preserveDrawingBuffer: 1 } : undefined;
    const handle = ck.GetWebGLContext(canvas, glAttrs);
    if (!handle) {
      return {
        surface: null,
        glContext: context,
        webglContext,
        contextCreated: false,
        contextDeleted: false,
      };
    }
    const grContext = ck.MakeGrContext(handle);
    if (!grContext) {
      ck.deleteContext(handle);
      return {
        surface: null,
        glContext: null,
        webglContext,
        contextCreated: true,
        contextDeleted: true,
      };
    }
    context = {
      grContext,
      delete() {
        grContext.delete();
        ck.deleteContext(handle);
      },
    };
    ownsContext = true;
  }

  const preferredSpace = editor.graph.documentColorSpace;
  const colorSpaces =
    preferredSpace === "display-p3"
      ? [ck.ColorSpace.DISPLAY_P3, ck.ColorSpace.SRGB]
      : [ck.ColorSpace.SRGB];

  for (const colorSpace of colorSpaces) {
    const surface = ck.MakeOnScreenGLSurface(
      context.grContext,
      canvas.width,
      canvas.height,
      colorSpace,
    );
    if (surface) {
      return {
        surface,
        glContext: context,
        webglContext,
        contextCreated: ownsContext,
        contextDeleted: false,
      };
    }
  }

  if (ownsContext) {
    context.delete();
    context = null;
  }
  return {
    surface: null,
    glContext: context,
    webglContext,
    contextCreated: ownsContext,
    contextDeleted: ownsContext,
  };
}

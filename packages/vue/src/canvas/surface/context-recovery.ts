type CanvasContextRecoveryOptions = {
  getCanvas: () => HTMLCanvasElement | null;
  isDestroyed: () => boolean;
  onRestored: () => void;
};

export function createCanvasContextRecovery({
  getCanvas,
  isDestroyed,
  onRestored,
}: CanvasContextRecoveryOptions) {
  let lost = false;
  let boundCanvas: HTMLCanvasElement | null = null;

  function onLost(event: Event) {
    event.preventDefault();
    lost = true;
  }

  function onRestoredEvent() {
    if (isDestroyed() || !lost) return;
    lost = false;
    if (getCanvas()) onRestored();
  }

  function bind(canvas: HTMLCanvasElement) {
    if (boundCanvas === canvas) return;
    unbind();
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestoredEvent);
    boundCanvas = canvas;
  }

  function unbind() {
    boundCanvas?.removeEventListener("webglcontextlost", onLost);
    boundCanvas?.removeEventListener("webglcontextrestored", onRestoredEvent);
    boundCanvas = null;
  }

  return {
    bind,
    unbind,
    isLost: () => lost,
  };
}

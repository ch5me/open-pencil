let activeController: AbortController | null = null;

export function beginFileOpen(parent?: AbortSignal) {
  activeController?.abort();
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  activeController = controller;

  return {
    signal: controller.signal,
    isCurrent: () => activeController === controller,
    finish() {
      parent?.removeEventListener("abort", abort);
      if (activeController === controller) activeController = null;
    },
  };
}

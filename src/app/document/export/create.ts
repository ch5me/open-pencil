import type { Editor, EditorState } from "@open-pencil/core/editor";
import type { ExportRequest, IORegistry } from "@open-pencil/core/io";
import { useTimeoutFn as createTimeout } from "@vueuse/core";

import {
  bundleExportFiles,
  createExportTargetActions,
  getExportBaseName,
  getExportBytes,
  getExportFileName,
  getExportOptions,
  saveExportedFile,
  type ExportedFile,
} from "@/app/document/export/files";
import type { ExportOptions } from "@/app/document/export/types";

type DownloadBlob = (data: Uint8Array, filename: string, mime: string) => void;
const EXPORT_TIMEOUT_MS = 60_000;

export interface ExportTargetRequest {
  target: ExportRequest["target"];
  formatId: string;
  options?: ExportOptions;
}

export function createDocumentExportActions(
  editor: Editor,
  state: EditorState,
  io: IORegistry,
  downloadBlob: DownloadBlob,
) {
  const { renderExportImage, getSelectionExportTarget, listSelectionExportFormats } =
    createExportTargetActions(editor, state, io);
  let activeExport: AbortController | null = null;
  const { start: startAbortDeadline, stop: clearAbortDeadline } = createTimeout(
    () => activeExport?.abort(),
    EXPORT_TIMEOUT_MS,
    { immediate: false },
  );

  async function renderExportFile(
    target: ExportRequest["target"],
    formatId: string,
    options?: ExportOptions,
    signal?: AbortSignal,
  ): Promise<ExportedFile> {
    const format = io.getFormat(formatId);
    if (!format) throw new Error(`Unknown export format: ${formatId}`);

    const exportOptions = getExportOptions(formatId, options);

    const result = await io.exportContent(
      formatId,
      { graph: editor.graph, target },
      exportOptions,
      {
        canvasKit: editor.renderer?.ck,
        renderer: editor.renderer ?? undefined,
        signal,
      },
    );

    const baseName = getExportBaseName(editor.graph, target);
    return {
      bytes: getExportBytes(result.data),
      fileName: getExportFileName(baseName, formatId, result.extension, options),
      format: format.label,
      ext: `.${result.extension}`,
      mime: result.mimeType,
    };
  }

  async function saveExportFile(file: ExportedFile) {
    await saveExportedFile(
      file.bytes,
      file.fileName,
      file.format,
      file.ext,
      file.mime,
      downloadBlob,
    );
  }

  async function runExport<T>(exportTask: (signal: AbortSignal) => Promise<T>): Promise<T> {
    activeExport?.abort();
    const controller = new AbortController();
    activeExport = controller;
    startAbortDeadline();
    try {
      return await exportTask(controller.signal);
    } finally {
      if (activeExport === controller) {
        clearAbortDeadline();
        activeExport = null;
      }
    }
  }

  async function exportTarget(
    target: ExportRequest["target"],
    formatId: string,
    options?: ExportOptions,
  ) {
    await runExport(async (signal) => {
      await saveExportFile(await renderExportFile(target, formatId, options, signal));
    });
  }

  // Export a batch of targets. A single file downloads directly; multiple files
  // are bundled into one zip so the user gets a single download.
  async function exportTargets(requests: ExportTargetRequest[]) {
    if (requests.length === 0) return;

    await runExport(async (signal) => {
      const files: ExportedFile[] = [];
      for (const request of requests) {
        files.push(
          await renderExportFile(request.target, request.formatId, request.options, signal),
        );
      }

      if (files.length === 1) {
        await saveExportFile(files[0]);
        return;
      }

      const baseNames = new Set(requests.map((r) => getExportBaseName(editor.graph, r.target)));
      const zipBaseName = baseNames.size === 1 ? [...baseNames][0] : "export";
      await saveExportedFile(
        bundleExportFiles(files),
        `${zipBaseName}.zip`,
        "ZIP",
        ".zip",
        "application/zip",
        downloadBlob,
      );
    });
  }

  async function exportSelection(
    scale: number,
    formatId: "png" | "jpg" | "webp" | "svg" | "pdf" | "fig",
  ) {
    await exportTarget(getSelectionExportTarget(), formatId, { scale });
  }

  return {
    renderExportImage,
    listSelectionExportFormats,
    exportTarget,
    exportTargets,
    exportSelection,
  };
}

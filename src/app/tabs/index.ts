import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";
import { readFigFile } from "@open-pencil/core/io/formats/fig";
import { computeAllLayouts } from "@open-pencil/core/layout";
import type { SceneGraph } from "@open-pencil/core/scene-graph";
import { shallowRef, computed, triggerRef } from "vue";

import { setOpenPencilStore } from "@/app/browser-bridge";
import { setActiveEditorStore } from "@/app/editor/active-store";
import { createEditorStore } from "@/app/editor/session";
import type { EditorStore } from "@/app/editor/session";

export interface Tab {
  id: string;
  store: EditorStore;
}

export interface RecentDocument {
  name: string;
  path: string;
}

const io = new IORegistry(BUILTIN_IO_FORMATS);
const RECENT_DOCUMENTS_KEY = "open-pencil.recent-documents";
const RECENT_DOCUMENT_LIMIT = 10;

let nextTabId = 1;

function generateTabId(): string {
  return `tab-${nextTabId++}`;
}

const tabsRef = shallowRef<Tab[]>([]);
const activeTabId = shallowRef("");
const recentDocumentsRef = shallowRef<RecentDocument[]>(loadRecentDocuments());

export const activeTab = computed(() => tabsRef.value.find((t) => t.id === activeTabId.value));

export const allTabs = computed(() =>
  tabsRef.value.map((t) => ({
    id: t.id,
    name: t.store.state.documentName,
    isDirty: t.store.isDirty(),
    isActive: t.id === activeTabId.value,
  })),
);

export const recentDocuments = computed(() => recentDocumentsRef.value);

function loadRecentDocuments(): RecentDocument[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_DOCUMENTS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is RecentDocument =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.name === "string" &&
        typeof entry.path === "string" &&
        entry.path.length > 0,
    );
  } catch {
    return [];
  }
}

function persistRecentDocuments() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RECENT_DOCUMENTS_KEY, JSON.stringify(recentDocumentsRef.value));
}

export function recordRecentDocument(name: string, path: string): void {
  if (!path) return;
  const entry = { name, path };
  recentDocumentsRef.value = [
    entry,
    ...recentDocumentsRef.value.filter((recent) => recent.path !== path),
  ].slice(0, RECENT_DOCUMENT_LIMIT);
  persistRecentDocuments();
}

export function getRecentDocuments(): RecentDocument[] {
  return [...recentDocumentsRef.value];
}

export function clearRecentDocuments(): void {
  recentDocumentsRef.value = [];
  persistRecentDocuments();
}

export function getActiveStore(): EditorStore {
  const tab = tabsRef.value.find((t) => t.id === activeTabId.value);
  if (!tab) throw new Error("No active tab");
  return tab.store;
}

export function getActiveTabId(): string {
  return activeTabId.value;
}

export function getTabById(tabId: string): Tab | undefined {
  return tabsRef.value.find((tab) => tab.id === tabId);
}

export function getTabForStore(store: EditorStore): Tab | undefined {
  return tabsRef.value.find((tab) => tab.store === store);
}

export function getTabsSnapshot(): Tab[] {
  return [...tabsRef.value];
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const s = store ?? createEditorStore(initialGraph);
  const tab: Tab = { id: generateTabId(), store: s };
  tabsRef.value = [...tabsRef.value, tab];
  activateTab(tab);
  return tab;
}

function activateTab(tab: Tab) {
  activeTabId.value = tab.id;
  setActiveEditorStore(tab.store);
  triggerRef(tabsRef);
  setOpenPencilStore(tab.store);
}

export function switchTab(tabId: string) {
  const tab = tabsRef.value.find((t) => t.id === tabId);
  if (!tab) return;
  activateTab(tab);
}

export function closeTab(tabId: string) {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  const closingTab = tabsRef.value[idx];
  if (
    closingTab.store.isDirty() &&
    typeof window !== "undefined" &&
    !window.confirm(`Unsaved changes in "${closingTab.store.state.documentName}". Close anyway?`)
  ) {
    return;
  }
  const wasActive = activeTabId.value === tabId;
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId);

  if (tabsRef.value.length === 0) {
    createTab();
    closingTab.store.dispose();
    return;
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1);
    activateTab(tabsRef.value[newIdx]);
  }

  closingTab.store.dispose();
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isDOMImportFile(file: File): boolean {
  return /\.(html?|xhtml)$/i.test(file.name);
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string,
): Promise<void> {
  const current = activeTab.value;
  const isUntouched =
    current?.store.state.documentName === "Untitled" && !current.store.undo.canUndo;
  const store = isUntouched ? current.store : createTab().store;
  if (isDOMImportFile(file)) {
    await store.openDOMFile(file, { handle, path });
    return;
  }

  const documentName = file.name.replace(/\.[^.]+$/i, "");

  store.state.documentName = documentName;
  store.state.loading = true;
  await yieldToUI();

  try {
    const isFig = file.name.toLowerCase().endsWith(".fig");
    const { graph: imported, sourceFormat } = isFig
      ? { graph: await readFigFile(file, { populate: "first-page" }), sourceFormat: "fig" }
      : await io.readDocument({
          name: file.name,
          mimeType: file.type || undefined,
          data: new Uint8Array(await file.arrayBuffer()),
        });

    const firstPageId = imported.getPages()[0]?.id;
    if (firstPageId) computeAllLayouts(imported, firstPageId);
    store.replaceGraph(imported);
    store.undo.clear();
    store.setDocumentSource(file.name, sourceFormat, handle, path);
    if (path) recordRecentDocument(file.name, path);
    store.clearSelection();
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId;
    await store.switchPage(pageId);
    await store.fitCurrentPageToViewport();
  } finally {
    store.state.loading = false;
  }
}

export function tabCount(): number {
  return tabsRef.value.length;
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createTab,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    openFileInNewTab,
    getActiveStore,
    tabCount,
    recentDocuments,
    getRecentDocuments,
    clearRecentDocuments,
  };
}

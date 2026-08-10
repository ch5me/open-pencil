import { expect, test, useEditorSetup } from "#tests/e2e/fixtures";

const editor = useEditorSetup();

test("Layers tab switches between layer tree and assets without remounting", async () => {
  const layersTab = editor.page.getByTestId("left-panel-layers-tab");
  const assetsTab = editor.page.getByTestId("left-panel-assets-tab");
  const layersPanel = editor.page.getByTestId("layers-tree");
  const assetsPanel = editor.page.getByTestId("assets-panel");

  await expect(layersPanel).toBeVisible();
  await expect(assetsPanel).toBeAttached();

  await assetsTab.click();
  await expect(assetsPanel).toBeVisible();
  await expect(layersPanel).toBeHidden();

  await layersTab.click();
  await expect(layersPanel).toBeVisible();
  await expect(assetsPanel).toBeHidden();
  editor.canvas.assertNoErrors();
});

test("Properties tabs switch views while keeping all panel content mounted", async () => {
  const designTab = editor.page.getByTestId("properties-tab-design");
  const codeTab = editor.page.getByTestId("properties-tab-code");
  const aiTab = editor.page.getByTestId("properties-tab-ai");
  const designPanel = editor.page.getByTestId("design-panel-empty");
  const codePanel = editor.page.getByTestId("code-panel-empty");
  const chatPanel = editor.page.getByTestId("chat-panel");

  await expect(designPanel).toBeVisible();
  await expect(codePanel).toBeAttached();
  await expect(chatPanel).toBeAttached();

  await codeTab.click();
  await expect(codePanel).toBeVisible();
  await expect(designPanel).toBeHidden();

  await aiTab.click();
  await expect(chatPanel).toBeVisible();
  await expect(codePanel).toBeHidden();

  await designTab.click();
  await expect(designPanel).toBeVisible();
  editor.canvas.assertNoErrors();
});

function getDocumentSnapshot() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.();
    if (!store) throw new Error("OpenPencil store not initialized");
    return {
      documentName: store.state.documentName,
      childCount: store.graph.getChildren(store.state.currentPageId).length,
    };
  });
}

test("document tabs isolate scene state and keep one tab after closing the last tab", async () => {
  await editor.canvas.clearCanvas();
  await editor.canvas.drawRect(120, 120, 80, 80);
  const firstDocument = await getDocumentSnapshot();
  expect(firstDocument.childCount).toBe(1);

  await editor.page.getByTestId("tabbar-new").click();
  const tabs = editor.page.getByTestId("tabbar-tab");
  await expect(tabs).toHaveCount(2);
  const secondDocument = await getDocumentSnapshot();
  expect(secondDocument.childCount).toBe(0);

  await tabs.nth(0).click();
  expect((await getDocumentSnapshot()).childCount).toBe(1);

  await tabs.nth(1).click();
  await expect(editor.page.getByTestId("tabbar-close").nth(1)).toBeVisible();
  await editor.page.getByTestId("tabbar-close").nth(1).click();
  await expect(tabs).toHaveCount(1);
  expect((await getDocumentSnapshot()).childCount).toBe(1);

  await editor.page.getByTestId("tabbar-close").click();
  await expect(tabs).toHaveCount(1);
  expect((await getDocumentSnapshot()).childCount).toBe(0);
  editor.canvas.assertNoErrors();
});

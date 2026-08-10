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

import { expect, test, useEditorSetup } from "#tests/e2e/fixtures";

const editor = useEditorSetup();

test("panel selections stay isolated per document workspace", async () => {
  const layersTab = editor.page.getByTestId("left-panel-layers-tab");
  const assetsTab = editor.page.getByTestId("left-panel-assets-tab");
  const designTab = editor.page.getByTestId("properties-tab-design");
  const aiTab = editor.page.getByTestId("properties-tab-ai");
  const layersPanel = editor.page.getByTestId("layers-tree");
  const assetsPanel = editor.page.getByTestId("assets-panel");
  const designPanel = editor.page.getByTestId("design-panel-empty");
  const chatPanel = editor.page.getByTestId("chat-panel");

  await layersTab.click();
  await designTab.click();
  await expect(layersPanel).toBeVisible();
  await expect(designPanel).toBeVisible();

  await assetsTab.click();
  await aiTab.click();
  await expect(assetsPanel).toBeVisible();
  await expect(chatPanel).toBeVisible();

  await editor.page.getByTestId("tabbar-new").click();
  await expect(editor.page.getByTestId("tabbar-tab")).toHaveCount(2);
  await expect(layersPanel).toBeVisible();
  await expect(designPanel).toBeVisible();
  await expect(assetsPanel).toBeHidden();
  await expect(chatPanel).toBeHidden();

  await editor.page.getByTestId("tabbar-tab").nth(0).click();
  await expect(assetsPanel).toBeVisible();
  await expect(chatPanel).toBeVisible();
  await expect(layersPanel).toBeHidden();
  await expect(designPanel).toBeHidden();
  editor.canvas.assertNoErrors();
});

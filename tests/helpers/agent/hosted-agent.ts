import { expect, type Page } from '@playwright/test'

export const AGENT_API_ORIGIN = process.env.TEST_AGENT_API_ORIGIN ?? 'http://127.0.0.1:8787'
export const DEV_STUB_ELF_TOKEN = 'call_30525cb2f86a407bad6be0f6'

export async function enableHostedAgent(page: Page): Promise<void> {
  await page.addInitScript(
    ({ apiOrigin, token }) => {
      window.openPencil ??= {}
      window.openPencil.test = {
        ...window.openPencil.test,
        forceHostedAgent: true,
        hostedApiOrigin: apiOrigin,
        hostedAuthToken: token
      }
    },
    { apiOrigin: AGENT_API_ORIGIN, token: DEV_STUB_ELF_TOKEN }
  )
}

export function agentInput(page: Page) {
  return page.getByTestId('chat-input')
}

export async function selectHostedAgent(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'AI' }).click()
  await expect(agentInput(page)).toBeVisible()
  await expect(page.getByTestId('provider-settings-trigger')).toBeHidden()
}

export async function selectedNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.openPencil?.getStore?.()?.state.selectedIds ?? [])])
}

export async function nodeExists(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (nodeId) => Boolean(window.openPencil?.getStore?.()?.graph.getNode(nodeId)),
    id
  )
}

export async function nodeIdByName(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate((nodeName) => {
    const nodes = window.openPencil?.getStore?.()?.graph.nodes.values()
    if (!nodes) return undefined
    return [...nodes].find((node) => node.name === nodeName)?.id
  }, name)
}

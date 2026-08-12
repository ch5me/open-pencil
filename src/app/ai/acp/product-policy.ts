import { getAutomationAuthToken } from "@/app/automation/mcp/spawn";

export interface ProductPermissionOption {
  optionId: string;
  kind: string;
  name: string;
}

export interface ProductPermissionRequest {
  requestId?: string;
  sessionId: string;
  options: ProductPermissionOption[];
  toolCall?: unknown;
}

export interface OpenPencilMcpServer {
  type: "http";
  name: "open-pencil";
  url: string;
  headers: Array<{ name: string; value: string }>;
}

export function buildOpenPencilMcpServers(
  automationAuthToken: string | null,
): OpenPencilMcpServer[] {
  return [
    {
      type: "http",
      name: "open-pencil",
      url: "http://127.0.0.1:7600/mcp",
      headers: automationAuthToken
        ? [{ name: "Authorization", value: `Bearer ${automationAuthToken}` }]
        : [],
    },
  ];
}

export async function getOpenPencilMcpServers(): Promise<OpenPencilMcpServer[]> {
  return buildOpenPencilMcpServers(await getAutomationAuthToken());
}

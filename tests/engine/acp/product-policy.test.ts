import { describe, expect, test } from "bun:test";

import { buildOpenPencilMcpServers } from "@/app/ai/acp/product-policy";

describe("OpenPencil ACP product policy", () => {
  test("injects the drawing MCP endpoint with its bearer token", () => {
    expect(buildOpenPencilMcpServers("automation-token")).toEqual([
      {
        type: "http",
        name: "open-pencil",
        url: "http://127.0.0.1:7600/mcp",
        headers: [{ name: "Authorization", value: "Bearer automation-token" }],
      },
    ]);
  });

  test("keeps the drawing MCP endpoint usable when local auth is disabled", () => {
    expect(buildOpenPencilMcpServers(null)).toEqual([
      {
        type: "http",
        name: "open-pencil",
        url: "http://127.0.0.1:7600/mcp",
        headers: [],
      },
    ]);
  });
});

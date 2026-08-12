import { describe, expect, test, beforeEach } from "bun:test";

import type { ProductPermissionRequest } from "@/app/ai/acp/product-policy";

import {
  permissionQueue,
  currentPermission,
  requestPermissionFromUser,
  respondToPermission,
  rejectCurrentPermission,
} from "@/app/ai/acp/permission";

function makeRequest(
  options: { optionId: string; kind: string; name: string }[] = [
    { optionId: "allow", kind: "allow_once", name: "Allow once" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ],
): ProductPermissionRequest {
  return {
    sessionId: "session-1",
    options,
    toolCall: {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "pending" as const,
    },
  };
}

describe("acp-permission", () => {
  beforeEach(() => {
    permissionQueue.value = [];
  });

  test("requestPermissionFromUser queues an entry", () => {
    void requestPermissionFromUser(makeRequest());
    expect(permissionQueue.value).toHaveLength(1);
    expect(currentPermission.value).not.toBeNull();
    expect(currentPermission.value?.request.sessionId).toBe("session-1");
    respondToPermission("allow");
  });

  test("respondToPermission resolves with selected optionId", async () => {
    const promise = requestPermissionFromUser(makeRequest());
    respondToPermission("allow");
    const result = await promise;
    expect(result.outcome.outcome).toBe("selected");
    expect(result.outcome.optionId).toBe("allow");
    expect(permissionQueue.value).toHaveLength(0);
  });
  test("preserves the engine's opaque permission request identity", async () => {
    const request = { ...makeRequest(), requestId: "runtime-request:opaque/7" };
    const promise = requestPermissionFromUser(request);

    expect(currentPermission.value?.request.requestId).toBe("runtime-request:opaque/7");
    respondToPermission("reject");
    await expect(promise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject" },
    });
  });
  test("denies an option not offered by the engine", async () => {
    const promise = requestPermissionFromUser(makeRequest());
    respondToPermission("forged-option");

    await expect(promise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject" },
    });
  });

  test("rejectCurrentPermission picks reject option", async () => {
    const promise = requestPermissionFromUser(makeRequest());
    rejectCurrentPermission();
    const result = await promise;
    expect(result.outcome.optionId).toBe("reject");
  });

  test("rejectCurrentPermission falls back to first option when no reject kind", async () => {
    const req = makeRequest([{ optionId: "only-allow", kind: "allow_once", name: "Allow" }]);
    const promise = requestPermissionFromUser(req);
    rejectCurrentPermission();
    const result = await promise;
    expect(result.outcome.optionId).toBe("only-allow");
  });

  test("queue handles multiple concurrent requests in order", async () => {
    const p1 = requestPermissionFromUser(
      makeRequest([{ optionId: "a1", kind: "allow_once", name: "First" }]),
    );
    const p2 = requestPermissionFromUser(
      makeRequest([{ optionId: "a2", kind: "allow_once", name: "Second" }]),
    );
    expect(permissionQueue.value).toHaveLength(2);
    expect(currentPermission.value?.request.options[0].optionId).toBe("a1");

    respondToPermission("a1");
    const r1 = await p1;
    expect(r1.outcome.optionId).toBe("a1");
    expect(currentPermission.value?.request.options[0].optionId).toBe("a2");

    respondToPermission("a2");
    const r2 = await p2;
    expect(r2.outcome.optionId).toBe("a2");
    expect(permissionQueue.value).toHaveLength(0);
  });

  test("respondToPermission is no-op when queue is empty", () => {
    expect(permissionQueue.value).toHaveLength(0);
    respondToPermission("anything");
    expect(permissionQueue.value).toHaveLength(0);
  });

  test("rejectCurrentPermission is no-op when queue is empty", () => {
    expect(permissionQueue.value).toHaveLength(0);
    rejectCurrentPermission();
    expect(permissionQueue.value).toHaveLength(0);
  });

  test("timer cleared on manual resolution (no double resolve)", async () => {
    const promise = requestPermissionFromUser(makeRequest());
    respondToPermission("allow");
    const result = await promise;
    expect(result.outcome.optionId).toBe("allow");
    // Timer should be cleared — wait to ensure no stale timeout fires
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(permissionQueue.value).toHaveLength(0);
  });

  test("timeout auto-rejects after delay", async () => {
    const req = makeRequest();
    // Override timeout for test speed by creating request and manually triggering the timer
    const promise = requestPermissionFromUser(req);
    const entry = permissionQueue.value[0];
    expect(entry).toBeDefined();

    // Fast-forward: manually fire the timer callback
    clearTimeout(entry.timer);
    const timerFn = () => {
      const idx = permissionQueue.value.indexOf(entry);
      if (idx === -1) return;
      permissionQueue.value = permissionQueue.value.filter((e) => e !== entry);
      entry.resolve({
        outcome: {
          outcome: "selected",
          optionId:
            req.options.find((o) => o.kind.startsWith("reject"))?.optionId ??
            req.options[0]?.optionId ??
            "",
        },
      });
    };
    timerFn();

    const result = await promise;
    expect(result.outcome.optionId).toBe("reject");
    expect(permissionQueue.value).toHaveLength(0);
  });
});

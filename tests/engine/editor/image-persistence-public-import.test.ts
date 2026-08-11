import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("built core package exports persistence from root and editor", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "open-pencil-core-import-"));
  const packageDirectory = fileURLToPath(new URL("../../../packages/core", import.meta.url));
  const packageLink = join(temporaryDirectory, "node_modules", "@open-pencil", "core");

  try {
    await mkdir(join(temporaryDirectory, "node_modules", "@open-pencil"), {
      recursive: true,
    });
    await symlink(packageDirectory, packageLink, "dir");
    const process = spawnSync(
      "node",
      [
        "--input-type=module",
        "--eval",
        `
          import * as core from "@open-pencil/core";
          import * as editor from "@open-pencil/core/editor";
          const names = [
            "AtomicWorkingDocumentPersistence",
            "createAcknowledgedWorkingDocumentIdentity",
            "createTerminationInjector",
            "estimateJsonOverhead",
            "PersistenceContractError",
            "PersistenceQuotaError",
            "detachPngDataUrls",
            "migrateWorkingDocumentRecord",
            "validateDetachedWorkingDocument",
            "verifyDetachedWorkingDocument",
          ];
          for (const name of names) {
            if (core[name] !== editor[name]) throw new Error(\`missing root persistence export: \${name}\`);
          }
          for (const api of [core, editor]) {
            const invalidCalls = [
              () => api.createAcknowledgedWorkingDocumentIdentity("", 1, "a".repeat(64)),
              () => api.createAcknowledgedWorkingDocumentIdentity("doc:one", -1, "a".repeat(64)),
              () => api.createAcknowledgedWorkingDocumentIdentity("doc:one", 1, ""),
              () => api.createTerminationInjector(0, ""),
              () => api.estimateJsonOverhead([]),
              () => api.estimateJsonOverhead(Object.defineProperty({}, "value", {
                enumerable: true,
                get() { throw new TypeError("public getter"); },
              })),
            ];
            for (const call of invalidCalls) {
              try {
                call();
                throw new Error("expected persistence contract failure");
              } catch (error) {
                if (!(error instanceof api.PersistenceContractError)) throw error;
              }
            }
          }
          console.log(names.join(","));
        `,
      ],
      {
        cwd: temporaryDirectory,
        encoding: "utf8",
      },
    );
    expect(process.stderr).toBe("");
    expect(process.status).toBe(0);
    expect(process.stdout).toContain("AtomicWorkingDocumentPersistence");
    expect(process.stdout).toContain("verifyDetachedWorkingDocument");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

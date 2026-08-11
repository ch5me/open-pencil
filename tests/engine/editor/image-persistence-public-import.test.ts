import { expect, test } from "bun:test";
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
    const process = Bun.spawn(
      [
        "node",
        "--input-type=module",
        "--eval",
        `
          import * as core from "@open-pencil/core";
          import * as editor from "@open-pencil/core/editor";
          const names = [
            "AtomicWorkingDocumentPersistence",
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
          console.log(names.join(","));
        `,
      ],
      {
        cwd: temporaryDirectory,
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stderr, stdout] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
      new Response(process.stdout).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("AtomicWorkingDocumentPersistence");
    expect(stdout).toContain("verifyDetachedWorkingDocument");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

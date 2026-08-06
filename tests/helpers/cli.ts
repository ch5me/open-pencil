import { cliSourcePath } from "./paths";

const CLI = cliSourcePath("index.ts");

export interface CLICommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runOpenPencilCLI(
  args: string[],
  options: { cwd?: string } = {},
): Promise<CLICommandResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

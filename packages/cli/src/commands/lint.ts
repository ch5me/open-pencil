import { allRules, createLinter, presets, type LintMessage } from "@open-pencil/core/lint";
import { defineCommand } from "citty";

import {
  checkedNodesForContext,
  createCh5ReviewReceipt,
  readCh5ReviewContext,
  readStableDocument,
} from "#cli/ch5-review-receipt";
import { bold, dim, fail, fmtList, ok } from "#cli/format";
import { loadDocument, loadDocumentBytes } from "#cli/headless";
import { finalizeImplementationProvenance } from "#cli/implementation-provenance";

const { version } = await import("../../package.json");

function formatSeverity(severity: LintMessage["severity"]) {
  if (severity === "error") return fail("error");
  if (severity === "warning") return fail("warn");
  return ok("info");
}

function formatMessage(message: LintMessage) {
  return {
    header: `${formatSeverity(message.severity)} ${bold(message.ruleId)} ${dim(message.nodePath.join(" / "))}`,
    details: {
      message: message.message,
      node: `${message.nodeName} (${message.nodeId})`,
      suggest: message.suggest,
    },
  };
}

export default defineCommand({
  meta: {
    name: "lint",
    description: "Lint design documents for consistency, structure, and accessibility issues",
  },
  args: {
    file: {
      type: "positional",
      required: true,
      description: "Design document to lint (.fig, .pen)",
    },
    preset: {
      type: "string",
      default: "recommended",
      description: "Preset: recommended, strict, accessibility",
    },
    rule: { type: "string", description: "Run specific rule(s) only (repeatable)" },
    json: { type: "boolean", default: false, description: "Output as JSON" },
    "ch5-review-context": {
      type: "string",
      description: "Emit strict ch5.open-pencil-lint/3 receipt using this context JSON",
    },
    "list-rules": { type: "boolean", default: false, description: "List rules and exit" },
  },
  async run({ args }) {
    const contextPath = args["ch5-review-context"];
    if (args["list-rules"] && contextPath) {
      throw new Error("--list-rules cannot be combined with --ch5-review-context");
    }
    if (args["list-rules"]) {
      console.log("");
      console.log(bold("Available rules"));
      console.log("");
      console.log(
        fmtList(
          Object.entries(allRules).map(([id, rule]) => ({
            header: bold(id),
            details: { category: rule.meta.category, description: rule.meta.description },
          })),
        ),
      );
      console.log("");
      console.log(bold(`Presets: ${Object.keys(presets).join(", ")}`));
      console.log("");
      return;
    }

    const startedAt = new Date().toISOString();
    const rules = args.rule ? (Array.isArray(args.rule) ? args.rule : [args.rule]) : undefined;
    const context = contextPath ? await readCh5ReviewContext(contextPath) : undefined;
    const document = context
      ? await readStableDocument(args.file, context.documentLocator)
      : undefined;
    const graph = document
      ? await loadDocumentBytes(document.locator, document.bytes)
      : await loadDocument(args.file);
    if (context && (args.preset !== "recommended" || rules)) {
      throw new Error(
        "CH5 review receipt mode requires the fixed recommended preset and no --rule overrides",
      );
    }
    const linter = createLinter({ preset: args.preset, rules });
    const checkedNodes = context ? checkedNodesForContext(context) : undefined;
    const result = checkedNodes ? linter.lintChecks(graph, checkedNodes) : linter.lintGraph(graph);
    const finishedAt = new Date().toISOString();

    if (context && document && checkedNodes) {
      const implementationDigest = await finalizeImplementationProvenance();
      console.log(
        JSON.stringify(
          createCh5ReviewReceipt({
            context,
            document,
            producerVersion: version,
            implementationDigest,
            startedAt,
            finishedAt,
            checkedNodes,
            ...result,
          }),
          null,
          2,
        ),
      );
    } else if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.messages.length === 0) {
      console.log(ok("No lint issues found."));
    } else {
      console.log("");
      console.log(
        bold(
          `Lint issues: ${result.errorCount} errors, ${result.warningCount} warnings, ${result.infoCount} info`,
        ),
      );
      console.log("");
      console.log(fmtList(result.messages.map(formatMessage)));
      console.log("");
    }

    if (result.errorCount > 0) process.exit(1);
  },
});

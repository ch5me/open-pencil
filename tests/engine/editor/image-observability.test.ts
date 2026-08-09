import { expect, test } from "bun:test";

import { EvidenceCollector, EvidenceContractError } from "#core/editor/image-observability";

const identity = { repo: "open-pencil", commit: "abc", runtime: "bun" };

test("collects lifecycle evidence and rejects zero output", () => {
  const collector = new EvidenceCollector("R-O", identity);
  collector.record("allocated", 0, 1);
  collector.record("published", 4, 2);
  collector.assertNonzeroOutput();
  expect(collector.receipt().outputBytes).toBe(4);
});

test("marks stale and substituted evidence visibly", () => {
  const collector = new EvidenceCollector("O-O", identity);
  collector.record("published", 1, 1, { ...identity, commit: "old" });
  collector.markSubstituted();
  const receipt = collector.receipt();
  expect(receipt.stale).toBe(true);
  expect(receipt.substituted).toBe(true);
  const empty = new EvidenceCollector("empty", identity);
  expect(() => empty.assertNonzeroOutput()).toThrow(EvidenceContractError);
});

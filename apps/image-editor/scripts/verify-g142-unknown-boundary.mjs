#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const proofPath = path.resolve(root, "docs/compatibility/g142-ug-gap-141-proof.json");
const consumerPath = path.resolve(root, "docs/compatibility/g142-ug-gap-141-mahjong-consumer.md");
const proof = JSON.parse(await readFile(proofPath, "utf8"));
const consumer = await readFile(consumerPath, "utf8");
const errors = [];

const expectedMatrix = ["firefox", "lowEndGpu", "orientation", "thermal", "memoryPressure", "longSession"];
if (proof.status !== "UNKNOWN") {
	errors.push(`top-level status must remain UNKNOWN, found ${proof.status}`);
}

const matrixKeys = Object.keys(proof.matrix ?? {});
if (matrixKeys.join(",") !== expectedMatrix.join(",")) {
	errors.push(`matrix keys changed: expected ${expectedMatrix.join(",")}, found ${matrixKeys.join(",")}`);
}
for (const key of expectedMatrix) {
	if (proof.matrix?.[key]?.status !== "UNKNOWN") {
		errors.push(`${key} status must remain UNKNOWN, found ${proof.matrix?.[key]?.status ?? "missing"}`);
	}
}

const proofBoundary = Object.entries(proof.proofBoundary ?? {});
for (const [key, value] of proofBoundary) {
	if (["sourceContracts", "syntheticResilienceEvaluator", "receiptIdentity"].includes(key)) {
		continue;
	}
	if (key === "seededDefect") {
		if (value !== "NOT_RUN") {
			errors.push(`seededDefect must remain NOT_RUN, found ${value}`);
		}
		continue;
	}
	if (value !== "UNKNOWN") {
		errors.push(`${key} boundary must remain UNKNOWN, found ${value}`);
	}
}

const seededDefect = proof.seededDefect;
if (seededDefect?.status !== "NOT_RUN" || seededDefect.scenarioCount !== 0 || seededDefect.outputCount !== 0) {
	errors.push("seeded-defect proof must remain explicitly not run with zero scenarios and outputs");
}
if (!consumer.startsWith("# G142 / UG-GAP-141 Consuming Matrix Evidence\n\nStatus: `UNKNOWN`")) {
	errors.push("consumer evidence must retain its UNKNOWN status");
}

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}

console.log(`G142 UNKNOWN boundary valid: ${expectedMatrix.length} matrix rows, seeded defect NOT_RUN`);

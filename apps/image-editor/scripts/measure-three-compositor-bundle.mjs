#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const reactAssets = path.resolve("dist/assets");
if (!existsSync(reactAssets)) {
	throw new Error("Image editor build missing; run bun run build first");
}

function measure(directory, pattern) {
	const files = readdirSync(directory).filter(file => pattern.test(file));
	if (files.length !== 1) {
		throw new Error(`expected one chunk matching ${pattern}, found ${files.length}`);
	}
	const bytes = readFileSync(path.join(directory, files[0]));
	return { file: files[0], rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}

const output = {
	react: {
		compositor: measure(reactAssets, /^compositor-core-.+\.js$/),
		wrapper: measure(reactAssets, /^react-wrapper-.+\.js$/),
		psd: measure(reactAssets, /^psd-adapter-.+\.js$/),
		entry: measure(reactAssets, /^index-.+\.js$/)
	}
};
console.log(JSON.stringify(output, null, 2));

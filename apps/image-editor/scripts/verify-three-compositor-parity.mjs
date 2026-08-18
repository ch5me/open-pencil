import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { chromiumGpuArguments } from "./chromium-gpu-arguments.mjs";
import { chromiumLaunchOptions } from "./chromium-launch-options.mjs";

const TOLERANCE = 3;
const REQUIRED_FEATURES = ["cpu", "webgpu", "webgl2", "groups", "masks", "rotation", "clipping", "adjustments"];
const REQUIRED_UNSUPPORTED = ["E_GROUP_MASK_UNSUPPORTED", "E_ADJUSTMENT_MASK_UNSUPPORTED", "E_CLIPPED_GROUP_UNSUPPORTED"];
const PORT = 4179;
const server = spawn("npx", ["--no-install", "vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
	stdio: ["ignore", "pipe", "pipe"]
});
const serverOutput = [];
server.stdout.on("data", chunk => {
	serverOutput.push(chunk);
});
server.stderr.on("data", chunk => {
	serverOutput.push(chunk);
});

async function waitForServer() {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${PORT}/scripts/three-compositor-parity/`);
			if (response.ok) {
				return;
			}
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Vite did not start: ${Buffer.concat(serverOutput).toString()}`);
}

function assertPixels(label, actual, expected) {
	if (actual.length !== expected.length) {
		throw new Error(`${label}: pixel length ${actual.length} != ${expected.length}`);
	}
	let maximum = 0;
	let mismatches = 0;
	for (const [index, element] of actual.entries()) {
		const delta = Math.abs(element - expected[index]);
		maximum = Math.max(maximum, delta);
		if (delta > TOLERANCE) {
			mismatches += 1;
		}
	}
	if (mismatches) {
		throw new Error(`${label}: ${mismatches} channels exceed tolerance ${TOLERANCE}; max delta ${maximum}`);
	}
	return maximum;
}

function assertSignedMeanBias(label, actual, expected) {
	const bias = actual.reduce((sum, value, index) => sum + value - expected[index], 0) / actual.length;
	if (Math.abs(bias) > 0.25) {
		throw new Error(`${label}: signed mean bias ${bias.toFixed(4)} exceeds ±0.25`);
	}
	return bias;
}

function assertSeededDefectRejected(label, actual, expected) {
	const defect = [...expected];
	defect[0] += 4;
	try {
		assertPixels(label, actual, defect);
		throw new Error(`${label}: seeded +4 channel defect was not rejected`);
	} catch (error) {
		if (error.message.includes("seeded +4 channel defect was not rejected")) {
			throw error;
		}
	}
}

async function openParityPage(browser) {
	const page = await browser.newPage({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on("pageerror", error => {
		errors.push(error.message);
	});
	page.on("console", message => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(`http://127.0.0.1:${PORT}/scripts/three-compositor-parity/`, { waitUntil: "networkidle" });
	await page.waitForFunction("typeof globalThis.runThreeCompositorScenario === 'function'");
	await page.waitForFunction("typeof globalThis.compositionFixtureContract === 'object'");
	return { page, errors };
}

async function verifyFixtureContract(page) {
	const contract = await page.evaluate("globalThis.compositionFixtureContract");
	if (contract.id !== "composition-full-v1") {
		throw new Error(`Unexpected fixture: ${contract.id}`);
	}
	for (const feature of REQUIRED_FEATURES) {
		if (!contract.axes.includes(feature)) {
			throw new Error(`composition-full-v1 missing axis: ${feature}`);
		}
	}
	for (const code of REQUIRED_UNSUPPORTED) {
		if (!contract.unsupported.includes(code)) {
			throw new Error(`composition-full-v1 missing typed unsupported code: ${code}`);
		}
	}
	for (const scenario of contract.scenarios) {
		for (const backend of ["cpu", "webgpu", "webgl2"]) {
			if (!scenario.backends.includes(backend)) {
				throw new Error(`${scenario.id} missing backend evidence: ${backend}`);
			}
		}
		for (const feature of ["groups", "masks", "rotation", "clipping", "adjustments"]) {
			if (!scenario.features.includes(feature)) {
				throw new Error(`${scenario.id} missing feature evidence: ${feature}`);
			}
		}
	}
	console.log("composition-full-v1: required axes and typed unsupported gaps declared");
}

async function verifyPixels(browser, forceWebGL, expectedBackend, name) {
	const { page, errors } = await openParityPage(browser);
	try {
		await verifyFixtureContract(page);
		const result = await page.evaluate(`globalThis.runThreeCompositorScenario(${JSON.stringify(forceWebGL)}, ${JSON.stringify(name)})`);
		if (result.backend !== expectedBackend) {
			throw new Error(`${name}: expected ${expectedBackend}, got ${result.backend}`);
		}
		const maximum = assertPixels(`${expectedBackend}/${name}`, result.actual, result.expected);
		const bias = assertSignedMeanBias(`${expectedBackend}/${name}`, result.actual, result.expected);
		if (!result.nonzeroOutput) {
			throw new Error(`${expectedBackend}/${name}: consuming output is all zero`);
		}
		assertSeededDefectRejected(`${expectedBackend}/${name}`, result.actual, result.expected);
		if (!result.identity?.packageVersion || !result.identity?.runtimeVersion) {
			throw new Error(`${expectedBackend}/${name}: renderer/runtime identity missing`);
		}
		console.log(`${expectedBackend}/${name}: RGBA8 readback within ±${TOLERANCE} (max ${maximum}), signed mean bias ${bias.toFixed(4)}, nonzero output; ${result.identity.packageVersion}/${result.identity.runtimeVersion}`);
		console.log(`${expectedBackend}/${name} seeded defect: +4 channel rejected`);
		if (errors.length > 0) {
			throw new Error(`Browser errors: ${errors.join("; ")}`);
		}
	} finally {
		await page.close();
	}
}

async function verifyContextLoss(browser) {
	const { page, errors } = await openParityPage(browser);
	try {
		const result = await page.evaluate("globalThis.runThreeCompositorScenario(true, \"context-loss\")");
		if (
			result.failures.length !== 1 ||
			!result.failures[0].startsWith("context-lost:") ||
			!result.renderRejected ||
			result.restoredGeneration !== 1 ||
			result.afterRestore.source !== 3 ||
			result.afterRestore.mask !== 1 ||
			!result.nonzeroOutput
		) {
			throw new Error(`WebGL context loss contract failed: ${JSON.stringify(result)}`);
		}
		if (errors.length > 0) {
			throw new Error(`Browser errors: ${errors.join("; ")}`);
		}
		console.log(`webgl2/context-loss: rejected while lost, generation ${result.restoredGeneration} restored, 4 textures reuploaded, nonzero output; ${result.identity.packageVersion}/${result.identity.runtimeVersion}`);
	} finally {
		await page.close();
	}
}

async function verifyTextureUploads(browser) {
	const { page, errors } = await openParityPage(browser);
	try {
		const result = await page.evaluate("globalThis.runThreeCompositorScenario(true, \"texture-uploads\")");
		const valid =
			result.initial.source === 3 &&
			result.initial.mask === 1 &&
			result.unchanged.total === result.initial.total &&
			result.afterSource.source === result.initial.source + 1 &&
			result.afterSource.mask === result.initial.mask &&
			result.afterMask.source === result.afterSource.source &&
			result.afterMask.mask === result.afterSource.mask + 1 &&
			result.nonzeroOutput;
		if (!valid) {
			throw new Error(`Texture upload contract failed: ${JSON.stringify(result)}`);
		}
		const seededDefect = structuredClone(result);
		seededDefect.unchanged.total += 1;
		const seededDefectRejected =
			seededDefect.unchanged.total !== seededDefect.initial.total;
		if (!seededDefectRejected) {
			throw new Error("Texture upload seeded defect was not rejected");
		}
		if (errors.length > 0) {
			throw new Error(`Browser errors: ${errors.join("; ")}`);
		}
		console.log(`webgl2/texture-uploads: unchanged +0, source +1, mask +1, nonzero output; ${result.identity.packageVersion}/${result.identity.runtimeVersion}`);
		console.log("webgl2/texture-uploads seeded defect: unchanged +1 rejected");
	} finally {
		await page.close();
	}
}

await waitForServer();
const browser = await chromium.launch(chromiumLaunchOptions({
	headless: true,
	args: chromiumGpuArguments
}));
try {
	for (const name of ["base", "reordered"]) {
		await verifyPixels(browser, false, "webgpu", name);
	}
	for (const name of ["base", "reordered"]) {
		await verifyPixels(browser, true, "webgl2", name);
	}
	await verifyTextureUploads(browser);
	await verifyContextLoss(browser);
	console.log("Three compositor CPU/GPU parity passed with real readPixels output.");
} finally {
	await browser.close();
	server.kill("SIGTERM");
}

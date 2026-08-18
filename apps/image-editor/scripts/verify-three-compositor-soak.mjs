import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumGpuArguments } from "./chromium-gpu-arguments.mjs";
import { chromiumLaunchOptions } from "./chromium-launch-options.mjs";

const rootPath = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const mime = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const mode = process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_MODE ?? "full";
const intervalMs = Number(process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_INTERVAL_MS ?? 2000);
const warmupMs = Number(process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_WARMUP_MS ?? 10 * 60_000);
const soakMs = Number(process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_DURATION_MS ?? 60 * 60_000);
const expectedCommit = process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_COMMIT;

if (!expectedCommit || !/^[0-9a-f]{40}$/u.test(expectedCommit)) {
	throw new Error("OPEN_PENCIL_IMAGE_EDITOR_SOAK_COMMIT must name the exact tested commit");
}
if (mode !== "full" && mode !== "smoke") {
	throw new Error("OPEN_PENCIL_IMAGE_EDITOR_SOAK_MODE must be full or smoke");
}
if (mode === "full" && (warmupMs < 10 * 60_000 || soakMs < 60 * 60_000 || intervalMs > 5000)) {
	throw new Error("Full soak requires >=10m warmup, >=60m measurement, and <=5s progress interval");
}
const outputPath = process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_OUTPUT ? path.resolve(process.env.OPEN_PENCIL_IMAGE_EDITOR_SOAK_OUTPUT) : null;
if (mode === "full" && !outputPath) {
	throw new Error("Full soak requires OPEN_PENCIL_IMAGE_EDITOR_SOAK_OUTPUT");
}
if ([intervalMs, warmupMs, soakMs].some(value => !Number.isSafeInteger(value)) || intervalMs < 250 || warmupMs < 1000 || soakMs < 1000) {
	throw new Error("Invalid soak timing");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
if (head !== expectedCommit || status) {
	throw new Error(`Soak requires clean exact commit ${expectedCommit}; got ${head}${status ? " with changes" : ""}`);
}

execFileSync("bun", ["run", "build"], { stdio: "inherit" });

const server = createServer(async (request, response) => {
	const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
	const relative = decodeURIComponent(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
	const file = path.resolve(rootPath, relative);
	if (file !== rootPath && !file.startsWith(`${rootPath}${path.sep}`)) {
		response.writeHead(403).end("Forbidden");
		return;
	}
	try {
		const body = await readFile(file);
		response.writeHead(200, { "content-type": mime[path.extname(relative)] ?? "application/octet-stream" }).end(body);
	} catch {
		response.writeHead(404).end("Not found");
	}
});

function hostIdentity() {
	const hardware = execFileSync("system_profiler", ["SPHardwareDataType", "-json"], { encoding: "utf8" });
	const item = JSON.parse(hardware).SPHardwareDataType[0];
	return { model: item.machine_model, chip: item.chip_type, memory: item.physical_memory, platform: `darwin-${process.arch}` };
}

function processes() {
	return execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8" }).split("\n").flatMap(row => {
		const match = row.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
		return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rssBytes: Number(match[3]) * 1024, command: match[4] }] : [];
	});
}

function browserRootPid(profileDirectory) {
	const matches = processes().filter(process => process.command.includes(profileDirectory));
	const root = matches.find(process => matches.every(candidate => candidate.pid !== process.ppid));
	if (!root) {
		throw new Error(`Could not identify Chromium root for ${profileDirectory}`);
	}
	return root.pid;
}

function processTree(rootPid) {
	const all = processes();
	const included = new Set([rootPid]);
	let changed = true;
	while (changed) {
		changed = false;
		addChildProcesses(all, included, () => {
			changed = true;
		});
	}
	const tree = all.filter(process => included.has(process.pid));
	return { count: tree.length, rssBytes: tree.reduce((total, process) => total + process.rssBytes, 0), pids: tree.map(process => process.pid) };
}

function addChildProcesses(processList, included, onAdd) {
	for (const process of processList) {
		if (!included.has(process.ppid) || included.has(process.pid)) {
			continue;
		}

		included.add(process.pid);
		onAdd();
	}
}

function processIdentities(pids) {
	const wanted = new Set(pids);
	return processes().filter(process => wanted.has(process.pid)).map(({ pid, command }) => ({ pid, command }));
}

async function waitForProcessExit(identities) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const current = new Map(processes().map(process => [process.pid, process.command]));
		if (identities.every(identity => current.get(identity.pid) !== identity.command)) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	const current = new Map(processes().map(process => [process.pid, process.command]));
	throw new Error(`Chromium processes retained after teardown: ${JSON.stringify(identities.filter(identity => current.get(identity.pid) === identity.command))}`);
}

function observePage(context, page) {
	const evidence = { errors: [], requestFailures: [], crashes: 0, activeWorkers: new Set() };
	page.on("pageerror", error => {
		evidence.errors.push(`page: ${error.message}`);
	});
	page.on("console", message => {
		if (message.type() === "error") {
			evidence.errors.push(`console: ${message.text()}`);
		}
	});
	page.on("requestfailed", request => {
		evidence.requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
	});
	page.on("crash", () => {
		evidence.crashes += 1;
	});
	context.on("weberror", error => {
		evidence.errors.push(`context: ${error.error().message}`);
	});
	page.on("worker", worker => {
		evidence.activeWorkers.add(worker);
		worker.on("close", () => {
			evidence.activeWorkers.delete(worker);
		});
	});
	return evidence;
}

async function canvasFingerprint(canvas) {
	const png = await canvas.screenshot({ timeout: 4000 });
	return { hash: png.reduce((value, byte) => ((value * 31) ^ byte) >>> 0, 0), png };
}

async function blankFingerprint(page, canvas) {
	const size = await canvas.evaluate(element => ({ width: element.width, height: element.height }));
	const blank = await page.evaluateHandle(({ width, height }) => {
		const element = globalThis.document.createElement("canvas");
		element.width = width;
		element.height = height;
		element.style.position = "fixed";
		element.style.inset = "0 auto auto 0";
		element.style.zIndex = "2147483647";
		globalThis.document.body.append(element);
		return element;
	}, size);
	const png = await blank.asElement().screenshot();
	await blank.asElement().evaluate(element => element.remove());
	await blank.dispose();
	return png.reduce((value, byte) => ((value * 31) ^ byte) >>> 0, 0);
}

async function jsHeapBytes(cdp) {
	await cdp.send("HeapProfiler.collectGarbage");
	const { metrics } = await cdp.send("Performance.getMetrics");
	const used = metrics.find(metric => metric.name === "JSHeapUsedSize")?.value;
	if (!Number.isFinite(used)) {
		throw new TypeError("Chromium did not expose JSHeapUsedSize");
	}
	return used;
}

async function waitForBackend(page, expected) {
	await page.waitForFunction(value => [value, "failed"].includes(globalThis.document.querySelector("[data-testid=backend]")?.textContent), expected);
	const actual = await page.getByTestId("backend").textContent();
	if (actual !== expected) {
		throw new Error(`Expected ${expected}, got ${actual}: ${await page.getByTestId("failure-panel").textContent().catch(() => "no detail")}`);
	}
}

async function progressFrame(page, selection, previousX, key) {
	const started = Date.now();
	await page.keyboard.press(key);
	while (Date.now() - started < 5000) {
		const box = await selection.boundingBox();
		if (box && box.x !== previousX) {
			return { x: box.x, latencyMs: Date.now() - started };
		}
		await page.waitForTimeout(50);
	}
	throw new Error(`No causal selection movement within 5s after ${key}`);
}

async function runPhase(page, canvas, selection, blankHash, durationMs, state) {
	const phaseStarted = Date.now();
	let nextTick = phaseStarted;
	while (Date.now() - phaseStarted < durationMs) {
		const progress = await progressFrame(page, selection, state.previousX, state.events % 2 === 0 ? "ArrowRight" : "ArrowLeft");
		state.previousX = progress.x;
		state.events += 1;
		state.maxLatencyMs = Math.max(state.maxLatencyMs, progress.latencyMs);
		const now = Date.now();
		if (state.lastEventAt) {
			state.maxGapMs = Math.max(state.maxGapMs, now - state.lastEventAt);
		}
		state.lastEventAt = now;
		if (state.events % 30 === 0) {
			const frame = await canvasFingerprint(canvas);
			if (frame.hash === blankHash) {
				throw new Error(`Blank frame at progress event ${state.events}`);
			}
			state.hash.update(frame.png);
			state.samples.push(frame.hash);
		}
		nextTick += intervalMs;
		if (nextTick > now) {
			await page.waitForTimeout(nextTick - now);
		}
	}
}

// The lane is an end-to-end assertion sequence; splitting its branches would obscure teardown ownership.
// eslint-disable-next-line complexity
async function runLane(url, backend, artifactDirectory) {
	const profileDirectory = await mkdtemp(path.join(tmpdir(), `open-pencil-image-editor-${backend}-`));
	let context;
	let cdp;
	let rootPid;
	let evidence;
	try {
		context = await chromium.launchPersistentContext(profileDirectory, chromiumLaunchOptions({ headless: true, args: chromiumGpuArguments, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }));
		const browser = context.browser();
		rootPid = browserRootPid(profileDirectory);
		const page = context.pages()[0] ?? await context.newPage();
		evidence = observePage(context, page);
		cdp = await context.newCDPSession(page);
		await cdp.send("Performance.enable");
		await page.goto(backend === "webgl2" ? `${url}?backend=webgl` : url, { waitUntil: "networkidle" });
		await page.getByTestId("canvas-workspace").click({ position: { x: 8, y: 8 } });
		await waitForBackend(page, backend);
		const workspace = page.getByTestId("canvas-workspace");
		const canvas = page.getByTestId("compositor-canvas");
		const selection = page.getByTestId("selection-box");
		await workspace.focus();
		const initial = await canvasFingerprint(canvas);
		const blankHash = await blankFingerprint(page, canvas);
		if (initial.hash === blankHash) {
			throw new Error(`${backend} initial frame is blank`);
		}
		const selectionBox = await selection.boundingBox();
		if (!selectionBox) {
			throw new Error(`${backend} selection box is unavailable`);
		}
		const state = { previousX: selectionBox.x, hash: createHash("sha256").update(initial.png), samples: [initial.hash], events: 0, maxLatencyMs: 0, maxGapMs: 0, lastEventAt: Date.now() };
		await runPhase(page, canvas, selection, blankHash, warmupMs, state);
		const warmProcesses = processTree(rootPid);
		if (warmProcesses.count < 2 || warmProcesses.rssBytes <= 0) {
			throw new Error(`${backend} process tree is incomplete: ${JSON.stringify(warmProcesses)}`);
		}
		const warmResidentBytes = warmProcesses.rssBytes;
		const warmJsHeapBytes = await jsHeapBytes(cdp);
		await runPhase(page, canvas, selection, blankHash, soakMs, state);
		const finalProcesses = processTree(rootPid);
		if (finalProcesses.count < 2 || finalProcesses.rssBytes <= 0) {
			throw new Error(`${backend} final process tree is incomplete: ${JSON.stringify(finalProcesses)}`);
		}
		const finalResidentBytes = finalProcesses.rssBytes;
		const finalJsHeapBytes = await jsHeapBytes(cdp);
		const residentGrowthBytes = finalResidentBytes - warmResidentBytes;
		const residentGrowthRatio = residentGrowthBytes / warmResidentBytes;
		if (residentGrowthBytes > 64 * 1024 * 1024 || residentGrowthRatio > 0.05) {
			throw new Error(`${backend} resident memory grew ${residentGrowthBytes} bytes (${(residentGrowthRatio * 100).toFixed(2)}%)`);
		}
		if (state.maxGapMs > 5000 || state.maxLatencyMs > 5000) {
			throw new Error(`${backend} progress exceeded 5s: gap=${state.maxGapMs} latency=${state.maxLatencyMs}`);
		}
		if (evidence.errors.length > 0 || evidence.requestFailures.length > 0 || evidence.crashes) {
			throw new Error(`${backend} runtime failures: ${JSON.stringify(evidence)}`);
		}
		const finalFrame = await canvas.screenshot({ path: path.join(artifactDirectory, `${backend}-final.png`) });
		return {
			backend, browser: browser.version(), progressEvents: state.events, blankFrames: 0,
			maxProgressGapMs: state.maxGapMs, maxCausalFrameLatencyMs: state.maxLatencyMs,
			frameSequenceSha256: state.hash.digest("hex"), sampleFingerprints: [...state.samples.slice(0, 3), ...state.samples.slice(-3)],
			finalFrameSha256: createHash("sha256").update(finalFrame).digest("hex"),
			pageErrors: evidence.errors.length, requestFailures: evidence.requestFailures.length, crashes: evidence.crashes,
			workersBeforeTeardown: evidence.activeWorkers.size, warmProcessCount: warmProcesses.count, finalProcessCount: finalProcesses.count,
			warmResidentBytes, finalResidentBytes, residentGrowthBytes, residentGrowthRatio,
			warmJsHeapBytes, finalJsHeapBytes, jsHeapGrowthBytes: finalJsHeapBytes - warmJsHeapBytes
		};
	} finally {
		const identities = rootPid ?
			processIdentities(processTree(rootPid).pids) :
			processes().filter(process => process.command.includes(profileDirectory)).map(({ pid, command }) => ({ pid, command }));
		let teardownError;
		try {
			await cdp?.detach().catch(() => undefined);
			await context?.close();
			await waitForProcessExit(identities);
			if (evidence?.activeWorkers.size) {
				teardownError = new Error(`${backend} retained ${evidence.activeWorkers.size} workers after teardown`);
			}
		} finally {
			await rm(profileDirectory, { recursive: true, force: true });
		}
		if (teardownError) {
			// Preserve teardown failure after profile cleanup completes.
			// eslint-disable-next-line no-unsafe-finally
			throw teardownError;
		}
	}
}

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
server.unref();
const address = server.address();
if (!address || typeof address === "string") {
	throw new Error("Soak server failed to start");
}
const artifactDirectory = outputPath ? path.join(path.dirname(outputPath), "g172-frames") : await mkdtemp(path.join(tmpdir(), "g172-frames-"));
await mkdir(artifactDirectory, { recursive: true });
try {
	const url = `http://127.0.0.1:${address.port}/`;
	const settled = await Promise.allSettled([runLane(url, "webgpu", artifactDirectory), runLane(url, "webgl2", artifactDirectory)]);
	const failures = settled.filter(result => result.status === "rejected");
	if (failures.length > 0) {
		throw new AggregateError(failures.map(result => result.reason), "One or more soak lanes failed");
	}
	const lanes = settled
		.filter(result => result.status === "fulfilled")
		.map(result => result.value);
	const result = {
		schema: "ch5.image-editor.d1-compositor-soak.v2",
		status: mode === "full" ? "PASS" : "SMOKE",
		commit: head,
		host: hostIdentity(),
		mode,
		warmupMs,
		soakMs,
		intervalMs,
		lanes,
		artifactDir: outputPath ? artifactDirectory : "TEMP_REMOVED",
		m1: "UNKNOWN",
		physicalDevice: "UNKNOWN",
		gpuContextLeak: "UNKNOWN",
		externalEditors: "UNKNOWN"
	};
	if (outputPath) {
		await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
	}
	console.log(`three compositor D1 ${mode} passed: ${JSON.stringify(result)}`);
} finally {
	server.close();
	server.closeAllConnections();
	if (!outputPath) {
		await rm(artifactDirectory, { recursive: true, force: true });
	}
}

/* eslint-disable max-lines -- This executable keeps one shared server and browser proof harness. */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox } from "playwright";
import { chromiumGpuArguments } from "./chromium-gpu-arguments.mjs";
import { chromiumLaunchOptions } from "./chromium-launch-options.mjs";

const root = new URL("../dist/", import.meta.url);
const rootPath = path.resolve(fileURLToPath(root));
const mime = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const persistenceIdentity = {
	databaseName: "open-pencil-image-editor-v1",
	storeName: "records",
	legacyStoreName: "working-documents",
	documentId: "open-pencil-image-editor-working-document",
	producerTipSetHash: "89dbc26a9b134ded7a7528b06546fba5277b1c63dabc1c01ca4d3265e20741ac"
};
const persistedViewport = { panX: 137, panY: -83, zoom: 1.375 };
const persistedSelection = "jade-fan";
const persistedHeadlineName = "Persistence proof headline";
const server = createServer(async (request, response) => {
	const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
	if (pathname === "/__persistence-reset__") {
		response.writeHead(200, { "content-type": "text/html" });
		response.end("<!doctype html><title>Persistence reset</title>");
		return;
	}
	const relative = decodeURIComponent(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
	const file = path.resolve(rootPath, relative);
	if (file !== rootPath && !file.startsWith(`${rootPath}${path.sep}`)) {
		response.writeHead(403);
		response.end("Forbidden");
		return;
	}
	try {
		const body = await readFile(file);
		response.writeHead(200, { "content-type": mime[path.extname(relative)] ?? "application/octet-stream" });
		response.end(body);
	} catch {
		response.writeHead(404);
		response.end("Not found");
	}
});

function collectErrors(context, page) {
	const errors = [];
	page.on("pageerror", error => {
		errors.push(`page: ${error.message}`);
	});
	page.on("console", message => {
		if (message.type() === "error") {
			errors.push(`console: ${message.text()}`);
		}
	});
	context.on("weberror", webError => {
		errors.push(`context: ${webError.error().message}`);
	});
	return errors;
}

async function waitForBackend(page, expected) {
	await page.waitForFunction(([selector, backends]) => {
		const value = globalThis.document.querySelector(selector)?.textContent;
		return backends.includes(value) || value === "failed";
	}, ["[data-testid=backend]", expected]);
	const backend = await page.getByTestId("backend").textContent();
	if (!expected.includes(backend)) {
		const failure = await page.getByTestId("failure-panel").textContent().catch(() => "no failure detail");
		throw new Error(`Expected backend ${expected.join(" or ")}, got ${backend}: ${failure}`);
	}
	return backend;
}

async function assertVisible(locator, name) {
	await locator.waitFor({ state: "visible" });
	const box = await locator.boundingBox();
	if (!box || box.width < 1 || box.height < 1) {
		throw new Error(`${name} has no visible area`);
	}
	return box;
}

async function compositorFingerprint(canvas) {
	const png = await canvas.screenshot({ animations: "disabled" });
	return {
		hash: png.reduce((hash, value) => ((hash * 31) ^ value) >>> 0, 0),
		bytes: png.byteLength
	};
}

async function loseWebGL2Context(canvas) {
	return canvas.evaluate(element => {
		const context = element.getContext("webgl2");
		const extension = context?.getExtension("WEBGL_lose_context");
		if (!extension) {
			throw new Error("WEBGL_lose_context unavailable");
		}
		extension.loseContext();
	});
}

async function canvasPixelFingerprint(canvas) {
	return canvas.evaluate(element => {
		const context = element.getContext("2d");
		if (!context) {
			throw new Error("Canvas 2D context unavailable for pixel fingerprint");
		}
		const pixels = context.getImageData(0, 0, element.width, element.height).data;
		return pixels.reduce((hash, value) => ((hash * 31) ^ value) >>> 0, 0);
	});
}

async function assertInput(locator, value, name) {
	await locator.fill(value);
	if (await locator.inputValue() !== value) {
		throw new Error(`${name} did not update to ${value}`);
	}
}

async function assertGeometryControls(page, values, context) {
	for (const [label, expected] of Object.entries(values)) {
		if (context === "input") {
			await assertInput(page.getByLabel(label, { exact: true }), expected, `Geometry ${label}`);
		} else if (await page.getByLabel(label, { exact: true }).inputValue() !== expected) {
			throw new Error(`JSON load did not restore saved geometry ${label}`);
		}
	}
}

async function readGeometryControls(page) {
	return Object.fromEntries(await Promise.all(
		["X", "Y", "W", "H", "Rotation"].map(async label => [
			label,
			await page.getByLabel(label, { exact: true }).inputValue()
		])
	));
}

async function assertPointerStrokeClearsRedo(page, maskTool) {
	await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
	await maskTool.focus();
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => globalThis.document.activeElement?.dataset.testid === "canvas-workspace");
	const selection = await assertVisible(page.getByTestId("selection-box"), "pointer mask selection");
	await dragPointer(page, selection, 24, 0);
	const redoButton = page.getByRole("button", { name: "Redo", exact: true });
	if (await redoButton.isDisabled() !== true) {
		throw new Error("Redo did not disable immediately after a new pointer mask stroke");
	}
}

function boxDiffers(left, right, dimensionsOnly = false) {
	if (!left || !right) {
		return false;
	}
	if (Math.abs(left.width - right.width) > 2 || Math.abs(left.height - right.height) > 2) {
		return true;
	}
	return !dimensionsOnly && (Math.abs(left.x - right.x) > 2 || Math.abs(left.y - right.y) > 2);
}

async function dragPointer(page, box, dx, dy) {
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
	await page.mouse.up();
}

async function clearPersistenceDatabase(page, url) {
	await page.goto(`${url}__persistence-reset__`, { waitUntil: "domcontentloaded" });
	await page.evaluate(async databaseName => {
		const request = globalThis.indexedDB.deleteDatabase(databaseName);
		await new Promise((resolve, reject) => {
			request.addEventListener("success", resolve);
			request.addEventListener("blocked", () => reject(new Error(`IndexedDB ${databaseName} deletion blocked`)));
			request.addEventListener("error", () => reject(request.error ?? new Error(`IndexedDB ${databaseName} deletion failed`)));
		});
		const databases = await globalThis.indexedDB.databases();
		if (databases.some(database => database.name === databaseName)) {
			throw new Error(`IndexedDB ${databaseName} still exists after deletion`);
		}
	}, persistenceIdentity.databaseName);
}

async function readPersistenceRecord(page) {
	// Browser-side IndexedDB validation is intentionally one atomic proof.
	// eslint-disable-next-line complexity
	return page.evaluate(async identity => {
		const databases = await globalThis.indexedDB.databases();
		if (databases.every(database => database.name !== identity.databaseName)) {
			throw new Error(`Missing IndexedDB ${identity.databaseName}`);
		}
		const database = await new Promise((resolve, reject) => {
			const request = globalThis.indexedDB.open(identity.databaseName);
			request.addEventListener("success", () => resolve(request.result));
			request.addEventListener("error", () => reject(request.error ?? new Error(`Could not open IndexedDB ${identity.databaseName}`)));
		});
		try {
			if (!database.objectStoreNames.contains(identity.storeName)) {
				throw new Error(`Missing IndexedDB store ${identity.storeName}`);
			}
			const manifest = await new Promise((resolve, reject) => {
				const request = database
					.transaction(identity.storeName, "readonly")
					.objectStore(identity.storeName)
					.get(`doc/${identity.documentId}/manifest`);
				request.addEventListener("success", () => resolve(request.result));
				request.addEventListener("error", () => reject(request.error ?? new Error(`Could not read persistence identity ${identity.documentId}`)));
			});
			if (manifest?.schema !== "open-pencil-editor-binary-v2" || !Array.isArray(manifest.roots)) {
				throw new TypeError(`Missing persistence identity ${identity.documentId}`);
			}
			const roots = manifest.roots;
			if (!Array.isArray(roots) || roots.length === 0) {
				throw new Error(`Persistence identity ${identity.documentId} has no roots`);
			}
			for (const root of roots) {
				if (
					root.schema !== "open-pencil-persistence-v1" ||
					root.documentId !== identity.documentId ||
					root.producerTipSetHash !== identity.producerTipSetHash ||
					typeof root.rootId !== "string" ||
					!/^[0-9a-f]{64}$/u.test(root.rootId) ||
					!Number.isSafeInteger(root.sequence) ||
					root.sequence < 0
				) {
					throw new TypeError(`Persistence identity mismatch: ${JSON.stringify({
						schema: root.schema,
						documentId: root.documentId,
						producerTipSetHash: root.producerTipSetHash,
						rootId: root.rootId,
						sequence: root.sequence
					})}`);
				}
			}
			const references = new Map();
			for (const root of roots) {
				const assetReferences = Object.values(root.payload?.assets ?? {});
				for (const reference of assetReferences) {
					references.set(reference.contentId, reference);
				}
			}
			if (references.size === 0) {
				throw new Error("Binary persistence proof has no asset records");
			}
			for (const [contentId, reference] of references) {
				const record = await new Promise((resolve, reject) => {
					const request = database
						.transaction(identity.storeName, "readonly")
						.objectStore(identity.storeName)
						.get(`blob/${contentId}`);
					request.addEventListener("success", () => resolve(request.result));
					request.addEventListener("error", () => reject(request.error ?? new Error(`Could not read binary asset ${contentId}`)));
				});
				if (
					record?.schema !== "open-pencil-image-editor-asset-v2" ||
					record.contentId !== contentId ||
					record.kind !== reference.kind ||
					record.mediaType !== reference.mediaType ||
					!(record.bytes instanceof ArrayBuffer) ||
					record.byteLength <= 0 ||
					record.bytes.byteLength !== record.byteLength
				) {
					throw new TypeError(`Invalid binary asset record ${contentId}`);
				}
				const metadata = new TextEncoder().encode(`${record.kind}\0${record.mediaType}\0`);
				const identityInput = new Uint8Array(metadata.byteLength + record.bytes.byteLength);
				identityInput.set(metadata);
				identityInput.set(new Uint8Array(record.bytes), metadata.byteLength);
				const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", identityInput))]
					.map(byte => byte.toString(16).padStart(2, "0"))
					.join("");
				if (digest !== contentId) {
					throw new TypeError(`Binary asset digest mismatch ${contentId}`);
				}
			}
			const legacy = await new Promise((resolve, reject) => {
				const request = database
					.transaction(identity.legacyStoreName, "readonly")
					.objectStore(identity.legacyStoreName)
					.get(identity.documentId);
				request.addEventListener("success", () => resolve(request.result));
				request.addEventListener("error", () => reject(request.error ?? new Error("Could not read legacy persistence record")));
			});
			if (legacy !== undefined) {
				throw new Error("Legacy Base64 persistence record remains after acknowledgement");
			}
			const latest = roots.slice().sort((left, right) => right.sequence - left.sequence)[0];
			return {
				...latest,
				binaryEvidence: {
					manifestSchema: manifest.schema,
					assetCount: references.size,
					legacyRecordAbsent: true
				}
			};
		} finally {
			database.close();
		}
	}, persistenceIdentity);
}

function matchesPersistedEditorState(root, expectedViewport) {
	const headline = root.payload?.document?.layers?.find(layer => layer.id === "headline");
	return (
		root.commitState === "acknowledged" &&
		root.payload?.viewport?.panX === expectedViewport.panX &&
		root.payload?.viewport?.panY === expectedViewport.panY &&
		Math.abs(root.payload.viewport.zoom - expectedViewport.zoom) < 1e-10 &&
		root.payload?.document?.selectedLayerId === persistedSelection &&
		headline?.name === persistedHeadlineName
	);
}

async function waitForPersistedEditorState(page, expectedViewport) {
	const deadline = Date.now() + 10_000;
	let latest;
	while (Date.now() < deadline) {
		try {
			latest = await readPersistenceRecord(page);
			if (matchesPersistedEditorState(latest, expectedViewport)) {
				return latest;
			}
		} catch (error) {
			if (!String(error).includes(`Missing IndexedDB ${persistenceIdentity.databaseName}`)) {
				throw error;
			}
		}
		await page.waitForTimeout(50);
	}
	if (!latest) {
		throw new Error(`Missing IndexedDB ${persistenceIdentity.databaseName} or persistence ACK`);
	}
	throw new Error(`Missing editor persistence ACK: ${JSON.stringify({
		commitState: latest.commitState,
		viewport: latest.payload?.viewport,
		selectedLayerId: latest.payload?.document?.selectedLayerId,
		headlineName: latest.payload?.document?.layers?.find(layer => layer.id === "headline")?.name
	})}`);
}

async function readViewportDom(page) {
	return page.locator(".canvas-stage").evaluate(element => {
		const transform = element.style.transform;
		const match = transform.match(
			/^translate\(-50%, -50%\) translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\) scale\((\d+(?:\.\d+)?)\)$/u
		);
		if (!match) {
			throw new Error(`Unexpected canvas viewport transform: ${transform}`);
		}
		return {
			panX: Number(match[1]),
			panY: Number(match[2]),
			zoom: Number(match[3])
		};
	});
}

async function waitForViewportDom(page, expected) {
	await page.waitForFunction(({ panX, panY, zoom }) => {
		const transform = globalThis.document.querySelector(".canvas-stage")?.style.transform ?? "";
		const match = transform.match(
			/^translate\(-50%, -50%\) translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\) scale\((\d+(?:\.\d+)?)\)$/u
		);
		return Boolean(
			match &&
			Number(match[1]) === panX &&
			Number(match[2]) === panY &&
			Math.abs(Number(match[3]) - zoom) < 1e-10
		);
	}, expected);
	const actual = await readViewportDom(page);
	const zoomText = await page.getByTestId("zoom-value").textContent();
	if (zoomText !== `${Math.round(expected.zoom * 100)}%`) {
		throw new Error(`Recovered zoom label mismatch: expected ${Math.round(expected.zoom * 100)}%, got ${zoomText}`);
	}
	return actual;
}

async function waitForRecoveredViewportBeforeInteraction(page, expected) {
	await page.waitForFunction(({ panX, panY, zoom }) => {
		if (globalThis.document.querySelector("[data-testid=backend]")?.textContent !== "compatibility") {
			return false;
		}
		const transform = globalThis.document.querySelector(".canvas-stage")?.style.transform ?? "";
		const match = transform.match(
			/^translate\(-50%, -50%\) translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\) scale\((\d+(?:\.\d+)?)\)$/u
		);
		return Boolean(
			match &&
			Number(match[1]) === panX &&
			Number(match[2]) === panY &&
			Math.abs(Number(match[3]) - zoom) < 1e-10
		);
	}, expected);
	return waitForViewportDom(page, expected);
}

async function runViewportReopen(browser, url, imagePath) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	try {
		await clearPersistenceDatabase(page, url);
		const errors = collectErrors(context, page);
		await page.goto(url, { waitUntil: "networkidle" });
		await page.getByTestId("autosave-status").filter({ hasText: "saved" }).waitFor();
		await page.getByTestId("canvas-workspace").click({ position: { x: 8, y: 8 } });
		const backend = await waitForBackend(page, ["webgpu", "webgl2"]);
		await page.getByRole("button", { name: "Fit", exact: true }).click();

		const headlineRow = layerRow(page, "headline");
		await headlineRow.getByRole("button", { name: /^Rename / }).click();
		const headlineName = headlineRow.getByRole("textbox");
		await headlineName.fill(persistedHeadlineName);
		await headlineName.press("Enter");
		await headlineRow.getByText(persistedHeadlineName, { exact: true }).waitFor({ state: "visible" });
		const imageChooserPromise = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Import image layer", exact: true }).click();
		const imageChooser = await imageChooserPromise;
		await imageChooser.setFiles(imagePath);
		await layerRow(page, "image-7").waitFor({ state: "visible" });
		const selectedRow = layerRow(page, persistedSelection);
		await selectedRow.click();
		await page.waitForFunction(
			id => [...globalThis.document.querySelectorAll("[data-sortable-tree-node]")]
				.some(element => element.dataset.sortableTreeNode === id && element.getAttribute("aria-selected") === "true"),
			persistedSelection
		);
		if (await page.getByRole("button", { name: "Undo", exact: true }).isDisabled()) {
			throw new Error("Content edit did not create undo history before persistence");
		}

		const initialViewport = await readViewportDom(page);
		if (
			initialViewport.panX === persistedViewport.panX &&
			initialViewport.panY === persistedViewport.panY &&
			Math.abs(initialViewport.zoom - persistedViewport.zoom) < 1e-10
		) {
			throw new Error("Deterministic persistence viewport matches the initial viewport");
		}
		await page.getByRole("button", { name: "Hand tool", exact: true }).click();
		await page.getByTestId("canvas-workspace").evaluate((element, { currentZoom, targetZoom }) => {
			const deltaY = -Math.log(targetZoom / currentZoom) / 0.0015;
			element.dispatchEvent(new globalThis.WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
		}, { currentZoom: initialViewport.zoom, targetZoom: persistedViewport.zoom });
		await page.waitForFunction(zoom => {
			const transform = globalThis.document.querySelector(".canvas-stage")?.style.transform ?? "";
			const match = transform.match(/scale\((\d+(?:\.\d+)?)\)$/u);
			return Boolean(match && Math.abs(Number(match[1]) - zoom) < 1e-10);
		}, persistedViewport.zoom);

		const workspace = await assertVisible(page.locator(".workspace-viewport"), "viewport persistence workspace");
		await dragPointer(page, workspace, persistedViewport.panX, persistedViewport.panY);
		await waitForViewportDom(page, persistedViewport);
		const beforeReload = await waitForPersistedEditorState(page, persistedViewport);

		await page.reload({ waitUntil: "networkidle" });
		await page.getByTestId("editor-message").filter({ hasText: "Recovered autosaved working document" }).waitFor();
		const recoveredSelection = layerRow(page, persistedSelection);
		if (await recoveredSelection.getAttribute("aria-selected") !== "true") {
			throw new Error(`Recovered selection mismatch: expected ${persistedSelection}`);
		}
		if (await page.getByRole("button", { name: "Undo", exact: true }).isDisabled() !== true) {
			throw new Error("Undo enabled before interaction after working-document recovery");
		}
		if (await page.getByRole("button", { name: "Redo", exact: true }).isDisabled() !== true) {
			throw new Error("Redo enabled before interaction after working-document recovery");
		}
		await headlineRow.getByText(persistedHeadlineName, { exact: true }).waitFor({ state: "visible" });
		const recoveredViewport = await waitForRecoveredViewportBeforeInteraction(page, persistedViewport);
		const afterReload = await waitForPersistedEditorState(page, persistedViewport);
		if (afterReload.sequence < beforeReload.sequence) {
			throw new Error(`Persistence sequence regressed across reload: ${beforeReload.sequence} -> ${afterReload.sequence}`);
		}
		if (errors.length > 0) {
			throw new Error(`Viewport reopen page errors: ${[...new Set(errors)].join("; ")}`);
		}
		return {
			browser: `Chromium ${browser.version()}`,
			backend,
			context: "same-context reload",
			persistence: {
				...persistenceIdentity,
				rootIdBeforeReload: beforeReload.rootId,
				rootIdAfterReload: afterReload.rootId,
				commitState: afterReload.commitState,
				...afterReload.binaryEvidence
			},
			viewport: recoveredViewport,
			document: {
				selectedLayerId: persistedSelection,
				headlineName: persistedHeadlineName,
				undoDisabledBeforeInteraction: true,
				redoDisabledBeforeInteraction: true
			}
		};
	} finally {
		await context.close();
	}
}

function layerRow(page, id) {
	return page.getByTestId(`layer-${id}`).locator("xpath=ancestor::*[@role='treeitem']");
}

// This journey validates the whole desktop contract in one browser context.
// eslint-disable-next-line complexity
async function runDesktop(browser, url, downloadPath, psdPath) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
	const page = await context.newPage();
	const errors = collectErrors(context, page);
	try {
		await page.goto(`${url}?backend=webgl`, { waitUntil: "networkidle" });
		await page.getByTestId("backend").filter({ hasText: "compatibility" }).waitFor();
		await page.getByTestId("canvas-workspace").click({ position: { x: 8, y: 8 } });
		const canvas = page.getByTestId("compositor-canvas");
		await assertVisible(canvas, "desktop canvas");
		await waitForBackend(page, ["webgl2"]);
		if (!["true", "false"].includes(await page.getByTestId("secure-context").textContent())) {
			throw new Error("Secure-context label missing");
		}

		await assertVisible(page.getByRole("navigation", { name: "Main menu" }), "main menu");
		await assertVisible(page.getByRole("toolbar", { name: "Tools" }), "tool rail");
		await assertVisible(page.getByTestId("canvas-workspace"), "canvas workspace");
		await assertVisible(page.getByRole("complementary", { name: "Editor panels" }), "layers/properties dock");
		await assertVisible(page.getByRole("status", { name: "Editor status" }), "status bar");

		const initialPixels = await compositorFingerprint(canvas);

		const selectedRow = layerRow(page, "headline");
		await selectedRow.click();
		const rename = selectedRow.getByRole("button", { name: /^Rename / });
		await rename.click();
		const nameInput = selectedRow.getByRole("textbox");
		await nameInput.fill("Proof headline");
		await nameInput.press("Enter");
		await selectedRow.getByText("Proof headline", { exact: true }).waitFor({ state: "visible" });

		await assertGeometryControls(page, { X: "120", Y: "110", W: "400", H: "140", Rotation: "22" }, "input");
		await page.getByLabel("Rotation", { exact: true }).blur();

		await assertInput(page.getByLabel("Opacity", { exact: true }), "0.45", "Opacity");
		await page.getByLabel("Blend mode", { exact: true }).selectOption("multiply");
		if (await page.getByLabel("Blend mode", { exact: true }).inputValue() !== "multiply") {
			throw new Error("Blend mode did not update");
		}
		await assertInput(page.getByLabel("Brightness", { exact: true }), "0.2", "Brightness");
		await page.waitForTimeout(100);
		if (initialPixels.hash === (await compositorFingerprint(canvas)).hash) {
			throw new Error("Layer properties did not change rendered pixels");
		}

		await selectedRow.getByRole("button", { name: "Hide Proof headline", exact: true }).click();
		await selectedRow.getByRole("button", { name: "Show Proof headline", exact: true }).waitFor({ state: "visible" });
		await selectedRow.getByRole("button", { name: "Show Proof headline", exact: true }).click();

		const rows = page.getByRole("treeitem");
		const baseCount = await rows.count();
		await page.getByRole("button", { name: "Duplicate selected layer", exact: true }).click();
		await page.waitForFunction(([selector, count]) => globalThis.document.querySelectorAll(selector).length === count + 1, ["[role=treeitem]", baseCount]);
		await page.getByRole("button", { name: "Delete selected layer", exact: true }).click();
		await page.waitForFunction(([selector, count]) => globalThis.document.querySelectorAll(selector).length === count, ["[role=treeitem]", baseCount]);

		await selectedRow.click();
		const target = layerRow(page, "artwork");
		if (await target.count() === 0) {
			throw new Error("No native layer drag target found");
		}
		const order = page.getByTestId("layer-order");
		const orderBeforeDrag = await order.textContent();
		await selectedRow.dragTo(target);
		await page.waitForFunction(([selector, previous]) => globalThis.document.querySelector(selector)?.textContent !== previous, ["[data-testid=layer-order]", orderBeforeDrag]);

		await page.getByRole("button", { name: "Move tool", exact: true }).click();
		const selection = page.locator(".selection-box");
		const beforeMove = await assertVisible(selection, "selection box");
		await dragPointer(page, beforeMove, 36, 24);
		const afterMove = await selection.boundingBox();
		if (!boxDiffers(beforeMove, afterMove)) {
			throw new Error("Canvas layer move did not change selection box");
		}

		const resizeHandle = page.getByTestId("handle-se");
		const handleBox = await assertVisible(resizeHandle, "bottom-right resize handle");
		const beforeResize = await selection.boundingBox();
		await dragPointer(page, handleBox, 34, 26);
		const afterResize = await selection.boundingBox();
		if (!boxDiffers(beforeResize, afterResize, true)) {
			throw new Error("Corner resize did not change selection size");
		}

		const workspace = page.getByTestId("canvas-workspace");
		const workspaceBox = await assertVisible(workspace, "canvas workspace");
		const zoom = page.getByTestId("zoom-value");
		const zoomBefore = await zoom.textContent();
		await page.mouse.move(workspaceBox.x + workspaceBox.width / 2, workspaceBox.y + workspaceBox.height / 2);
		await page.mouse.wheel(0, -360);
		await page.waitForFunction(([selector, previous]) => globalThis.document.querySelector(selector)?.textContent !== previous, ["[data-testid=zoom-value]", zoomBefore]);
		const zoomed = await zoom.textContent();
		await page.getByRole("button", { name: "Fit", exact: true }).click();
		await page.waitForFunction(([selector, previous]) => globalThis.document.querySelector(selector)?.textContent !== previous, ["[data-testid=zoom-value]", zoomed]);

		await page.getByRole("button", { name: "Undo", exact: true }).click();
		const afterUndo = await selection.boundingBox();
		if (!boxDiffers(afterResize, afterUndo)) {
			throw new Error("Undo did not change editor state");
		}
		await page.getByRole("button", { name: "Redo", exact: true }).click();
		const afterRedo = await selection.boundingBox();
		if (!boxDiffers(afterUndo, afterRedo)) {
			throw new Error("Redo did not restore editor state");
		}

		const layersBeforeMaskProof = await page.getByRole("treeitem").count();
		await page.getByRole("button", { name: "Add image layer", exact: true }).click();
		await page.getByRole("button", { name: "Add image layer", exact: true }).click();
		await page.waitForFunction(([selector, count]) => globalThis.document.querySelectorAll(selector).length === count + 2, ["[role=treeitem]", layersBeforeMaskProof]);
		await layerRow(page, "image-7").click();
		await page.getByRole("button", { name: "Toggle mask", exact: true }).click();
		await page.getByRole("button", { name: "Mask brush tool", exact: true }).click();
		const maskSelection = await assertVisible(page.getByTestId("selection-box"), "mask selection");
		await dragPointer(page, maskSelection, 28, 0);
		await layerRow(page, "image-8").click();
		await page.getByRole("button", { name: "Toggle clipping", exact: true }).click();
		await layerRow(page, "image-7").click();
		await page.getByRole("button", { name: "Toggle mask", exact: true }).click();
		await page.waitForTimeout(100);

		await page.getByRole("button", { name: "Add adjustment layer", exact: true }).click();
		if (await page.getByLabel("Blur", { exact: true }).count() !== 0) {
			throw new Error("Adjustment layer exposes unsupported blur control");
		}
		await assertInput(page.getByLabel("Brightness", { exact: true }), "0.4", "Adjustment brightness");
		await assertInput(page.getByLabel("Opacity", { exact: true }), "0.5", "Adjustment opacity");
		await page.getByLabel("Opacity", { exact: true }).blur();
		await page.waitForTimeout(100);

		await layerRow(page, "headline").click();
		const savedGeometry = await readGeometryControls(page);
		const downloadPromise = page.waitForEvent("download");
		await page.getByRole("button", { name: "Save JSON", exact: true }).click();
		const download = await downloadPromise;
		await download.saveAs(downloadPath);
		if (await download.failure()) {
			throw new Error(`Save JSON failed: ${await download.failure()}`);
		}

		const chooserPromise = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Load JSON", exact: true }).click();
		const chooser = await chooserPromise;
		await chooser.setFiles(downloadPath);
		await page.getByTestId("compositor-canvas").waitFor({ state: "visible" });
		await page.getByRole("button", { name: "Fit", exact: true }).click();
		await layerRow(page, "headline").click();
		await layerRow(page, "headline").getByText("Proof headline", { exact: true }).waitFor({ state: "visible" });
		if (await page.getByLabel("Opacity", { exact: true }).inputValue() !== "0.45") {
			throw new Error("JSON load did not restore saved opacity");
		}
		if (await page.getByLabel("Blend mode", { exact: true }).inputValue() !== "multiply") {
			throw new Error("JSON load did not restore saved blend mode");
		}
		await assertGeometryControls(page, savedGeometry, "loaded");

		const psdDownloadPromise = page.waitForEvent("download");
		await page.getByRole("button", { name: "Export PSD", exact: true }).click();
		const psdDownload = await psdDownloadPromise;
		await psdDownload.saveAs(psdPath);
		if (await psdDownload.failure()) {
			throw new Error(`PSD export failed: ${await psdDownload.failure()}`);
		}
		await page.getByTestId("editor-message").filter({ hasText: "Exported PSD" }).waitFor({ state: "visible" });

		const psdChooserPromise = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Import PSD", exact: true }).click();
		const psdChooser = await psdChooserPromise;
		await psdChooser.setFiles(psdPath);
		await page.getByTestId("editor-message").filter({ hasText: "Imported night-market.psd" }).waitFor({ state: "visible" });
		if (await page.getByRole("treeitem").count() === 0) {
			throw new Error("PSD round trip produced no layers");
		}
		const backendBeforeRecovery = await page.getByTestId("backend").textContent();
		const generationBeforeRecovery = Number(await page.getByTestId("compositor-generation").textContent());
		await page.getByTestId("compositor-canvas").evaluate(element => {
			element.__g176LostCanvas = true;
		});
		const pixelsBeforeRecovery = await compositorFingerprint(page.getByTestId("compositor-canvas"));
		if (pixelsBeforeRecovery.bytes < 1_000) {
			throw new Error("Pre-recovery compositor screenshot is unexpectedly small");
		}
		await loseWebGL2Context(page.getByTestId("compositor-canvas"));
		await page.getByTestId("failure-panel").waitFor({ state: "visible" });
		await page.waitForFunction(
			({ backend, generation }) => {
				const currentBackend = globalThis.document.querySelector("[data-testid=backend]")?.textContent;
				const currentGeneration = Number(globalThis.document.querySelector("[data-testid=compositor-generation]")?.textContent);
				return currentBackend === backend && currentGeneration === generation + 1;
			},
			{ backend: backendBeforeRecovery, generation: generationBeforeRecovery }
		);
		await page.getByTestId("failure-panel").waitFor({ state: "detached" });
		const recoveredCanvas = page.getByTestId("compositor-canvas");
		await assertVisible(recoveredCanvas, "recovered compositor canvas");
		if (await recoveredCanvas.evaluate(element => element.__g176LostCanvas === true)) {
			throw new Error("WebGL recovery reused the lost canvas element");
		}
		const recoveredPixels = await compositorFingerprint(recoveredCanvas);
		if (recoveredPixels.bytes < 1_000) {
			throw new Error("Recovered compositor screenshot is unexpectedly small");
		}

		if (errors.length > 0) {
			throw new Error(`Desktop page errors: ${[...new Set(errors)].join("; ")}`);
		}
	} finally {
		await context.close();
	}
}

async function runMaskKeyboardJourney(browser, url) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	const errors = collectErrors(context, page);
	try {
		await page.goto(url, { waitUntil: "networkidle" });

		const layer = layerRow(page, "jade-fan");
		await layer.focus();
		await page.keyboard.press("Enter");
		await page.getByRole("status", { name: "Editor status" }).filter({ hasText: "Selected Jade fan" }).waitFor();

		const maskToggle = page.getByRole("button", { name: "Toggle mask", exact: true });
		await maskToggle.focus();
		await page.keyboard.press("Enter");
		await page.waitForFunction(() => globalThis.document.querySelector("[aria-label='Toggle mask']")?.getAttribute("aria-pressed") === "true");

		const maskTool = page.getByRole("button", { name: "Mask brush tool", exact: true });
		await maskTool.focus();
		await page.keyboard.press("Enter");
		const workspace = page.getByTestId("canvas-workspace");
		await page.waitForFunction(() => globalThis.document.activeElement?.dataset.testid === "canvas-workspace");
		const cursor = page.getByTestId("mask-keyboard-cursor");
		const cursorBefore = await assertVisible(cursor, "mask keyboard cursor");
		const canvas = page.getByLabel("Canvas 2D compatibility renderer");
		await assertVisible(canvas, "keyboard journey compatibility canvas");
		const pixelsBefore = await canvasPixelFingerprint(canvas);

		await page.keyboard.press("ArrowRight");
		const cursorAfter = await cursor.boundingBox();
		if (!cursorAfter || cursorAfter.x <= cursorBefore.x) {
			throw new Error("ArrowRight did not move the mask keyboard cursor");
		}
		await page.keyboard.press("Space");
		await page.getByTestId("mask-keyboard-state").filter({ hasText: "Mask erased." }).waitFor();
		await page.waitForTimeout(100);
		const erasedPixels = await canvasPixelFingerprint(canvas);
		if (erasedPixels === pixelsBefore) {
			throw new Error("Space did not erase mask pixels");
		}

		await page.keyboard.press("e");
		await page.getByTestId("mask-keyboard-state").filter({ hasText: "Reveal mode selected." }).waitFor();
		await page.keyboard.press("Space");
		await page.getByTestId("mask-keyboard-state").filter({ hasText: "Mask revealed." }).waitFor();
		await page.waitForTimeout(100);
		const revealedPixels = await canvasPixelFingerprint(canvas);
		if (revealedPixels === erasedPixels) {
			throw new Error("Space did not reveal mask pixels");
		}

		const describedBy = await workspace.getAttribute("aria-describedby");
		const keyboardShortcuts = await workspace.getAttribute("aria-keyshortcuts");
		const descriptions = new Set(describedBy?.split(/\s+/));
		const shortcuts = new Set(keyboardShortcuts?.split(/\s+/));
		if (!descriptions.has("canvas-instructions") || !shortcuts.has("Space") || !shortcuts.has("E")) {
			throw new Error("Canvas workspace lacks complete keyboard instructions or shortcut state");
		}

		await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
		await page.getByTestId("mask-keyboard-state").filter({ hasText: "Undo complete." }).waitFor();
		await page.waitForFunction(() => globalThis.document.querySelector("[aria-label='Toggle mask']")?.getAttribute("aria-pressed") === "true");
		await page.waitForTimeout(100);
		const undonePixels = await canvasPixelFingerprint(canvas);
		if (undonePixels !== erasedPixels) {
			throw new Error("Undo did not restore exact pre-stroke mask pixels");
		}
		if (await workspace.evaluate(element => element === globalThis.document.activeElement) !== true) {
			throw new Error("Undo moved focus away from the canvas workspace");
		}
		await page.keyboard.press("Escape");
		if (await maskTool.evaluate(element => element === globalThis.document.activeElement) !== true) {
			throw new Error("Escape immediately after undo did not restore valid mask-tool focus");
		}
		if (await maskTool.getAttribute("aria-pressed") !== "false") {
			throw new Error("Escape immediately after undo did not leave mask tool mode");
		}
		await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
		await page.getByTestId("mask-keyboard-state").filter({ hasText: "Redo complete." }).waitFor();
		await page.waitForFunction(() => globalThis.document.querySelector("[aria-label='Toggle mask']")?.getAttribute("aria-pressed") === "true");
		await page.waitForTimeout(100);
		const redonePixels = await canvasPixelFingerprint(canvas);
		if (redonePixels !== revealedPixels) {
			throw new Error(`Redo did not restore exact stroke mask pixels: expected ${revealedPixels}, got ${redonePixels}`);
		}
		if (await maskTool.evaluate(element => element === globalThis.document.activeElement) !== true) {
			throw new Error("Redo moved focus away from the enabled mask tool");
		}

		await assertPointerStrokeClearsRedo(page, maskTool);

		if (errors.length > 0) {
			throw new Error(`Mask keyboard page errors: ${[...new Set(errors)].join("; ")}`);
		}
	} finally {
		await context.close();
	}
}

async function runAccessibilityScan(browser, url) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	const errors = collectErrors(context, page);
	try {
		await clearPersistenceDatabase(page, url);
		await page.goto(url, { waitUntil: "networkidle" });
		await page.getByTestId("autosave-status").filter({ hasText: "saved" }).waitFor();

		const layer = layerRow(page, "jade-fan");
		await layer.focus();
		await page.keyboard.press("Enter");
		const maskToggle = page.getByRole("button", { name: "Toggle mask", exact: true });
		await maskToggle.focus();
		await page.keyboard.press("Enter");
		const maskTool = page.getByRole("button", { name: "Mask brush tool", exact: true });
		await maskTool.focus();
		await page.keyboard.press("Enter");
		await page.waitForFunction(() => globalThis.document.activeElement?.dataset.testid === "canvas-workspace");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Space");
		await page.getByTestId("mask-keyboard-state").filter({ hasText: "Mask erased." }).waitFor();

		const accessibilityResult = await new AxeBuilder({ page }).analyze();
		const seriousCritical = accessibilityResult.violations
			.filter(violation => violation.impact === "serious" || violation.impact === "critical");
		if (seriousCritical.length > 0) {
			throw new Error(`Accessibility scan found serious/critical violations: ${seriousCritical.map(({ id, nodes }) => `${id}(${nodes.flatMap(node => node.target).join("|")})`).join(", ")}`);
		}

		await page.evaluate(() => {
			const seeded = globalThis.document.createElement("button");
			seeded.dataset.testid = "a11y-seed";
			globalThis.document.body.append(seeded);
		});
		const seededAccessibilityResult = await new AxeBuilder({ page }).include("[data-testid=a11y-seed]").analyze();
		const seededViolations = seededAccessibilityResult.violations
			.filter(violation => violation.impact === "serious" || violation.impact === "critical");
		if (seededViolations.every(({ id }) => id !== "button-name")) {
			throw new Error(`Accessibility oracle missed seeded button-name defect: ${seededViolations.map(({ id }) => id).join(", ")}`);
		}

		await page.keyboard.press("Escape");
		if (await maskTool.evaluate(element => element === globalThis.document.activeElement) !== true) {
			throw new Error("Accessibility journey did not restore mask-tool focus");
		}
		if (errors.length > 0) {
			throw new Error(`Accessibility page errors: ${[...new Set(errors)].join("; ")}`);
		}
		return {
			browser: browser.version(),
			seriousCriticalViolations: 0,
			seededDefectRejected: "button-name",
			focusRestored: true,
			nonPointerMaskJourney: true
		};
	} finally {
		await context.close();
	}
}

async function assertMobileUsable(page, locator, name) {
	await locator.scrollIntoViewIfNeeded();
	const box = await assertVisible(locator, name);
	const viewport = page.viewportSize();
	if (!viewport || box.x < -1 || box.x + box.width > viewport.width + 1 || box.width < 24 || box.height < 24) {
		throw new Error(`${name} overflows or is unusable on mobile`);
	}
}

async function runMobile(browser, url) {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	const errors = collectErrors(context, page);
	try {
		await page.goto(`${url}?backend=webgl`, { waitUntil: "networkidle" });
		await page.getByTestId("canvas-workspace").click({ position: { x: 8, y: 8 } });
		await waitForBackend(page, ["webgl2"]);
		await assertMobileUsable(page, page.getByTestId("canvas-workspace"), "mobile workspace");
		await assertMobileUsable(page, page.getByRole("toolbar", { name: "Tools" }), "mobile tool rail");
		await assertMobileUsable(page, page.getByRole("complementary", { name: "Editor panels" }), "mobile layers dock");
		await assertMobileUsable(page, page.getByTestId("compositor-canvas"), "mobile canvas");
		const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
		if (overflow > 1) {
			throw new Error(`Mobile page horizontally overflows by ${overflow}px`);
		}

		const zoom = page.getByTestId("zoom-value");
		const zoomBefore = await zoom.textContent();
		const workspaceBox = await page.getByTestId("canvas-workspace").boundingBox();
		if (!workspaceBox) {
			throw new Error("Mobile workspace has no bounds");
		}
		await page.mouse.move(workspaceBox.x + workspaceBox.width / 2, workspaceBox.y + workspaceBox.height / 2);
		await page.mouse.wheel(0, -240);
		await page.waitForFunction(([selector, previous]) => globalThis.document.querySelector(selector)?.textContent !== previous, ["[data-testid=zoom-value]", zoomBefore]);
		await page.getByRole("button", { name: "Fit", exact: true }).click();

		const count = await page.getByRole("treeitem").count();
		await page.getByRole("button", { name: "Add text layer", exact: true }).click();
		await page.waitForFunction(([selector, previous]) => globalThis.document.querySelectorAll(selector).length === previous + 1, ["[role=treeitem]", count]);
		await assertInput(page.getByLabel("Opacity", { exact: true }), "0.6", "Mobile opacity");
		await page.getByTestId("compositor-canvas").waitFor({ state: "visible" });

		if (errors.length > 0) {
			throw new Error(`Mobile page errors: ${[...new Set(errors)].join("; ")}`);
		}
	} finally {
		await context.close();
	}
}

async function runNestedGroupProof(browser, url) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	const errors = collectErrors(context, page);
	try {
		await clearPersistenceDatabase(page, url);
		await page.goto(`${url}?proof=nested-group`, { waitUntil: "networkidle" });
		const pixelOutput = page.getByTestId("nested-group-pixel");
		await pixelOutput.waitFor({ state: "visible" });
		const pixel = await pixelOutput.textContent();
		const uiPackageVersion = await page.getByTestId("ui-package-version").textContent();
		if (uiPackageVersion !== "0.10.0") {
			throw new Error(`Expected installed @ch5me/ch5-ui-web 0.10.0, got ${uiPackageVersion}`);
		}
		const sortableTreeNodes = await page.locator("[data-sortable-tree-node]").count();
		if (sortableTreeNodes < 1) {
			throw new Error("Installed SortableTree rendered no document layers");
		}
		const installedCorePixel = await page.getByTestId("open-pencil-core-pixel").textContent();
		if (installedCorePixel !== "137,137,137,255") {
			throw new Error(`Installed OpenPencil core pixel mismatch: ${installedCorePixel}`);
		}
		const installedCoreSeededPixel = await page
			.getByTestId("open-pencil-core-seeded-pixel")
			.textContent();
		if (installedCoreSeededPixel !== "138,138,138,255") {
			throw new Error(
				`Installed OpenPencil core seeded oracle mismatch: ${installedCoreSeededPixel}`
			);
		}
		await page.getByTestId("canvas-workspace").click({ position: { x: 8, y: 8 } });
		const backend = await waitForBackend(page, ["webgpu", "webgl2"]);
		const expected = "188,0,188,72";
		const assertPixel = (actualPixel, expectedPixel) => {
			if (actualPixel !== expectedPixel) {
				throw new Error(`Nested-group pixel mismatch: expected ${expectedPixel}, got ${actualPixel}`);
			}
		};
		assertPixel(pixel, expected);
		const seededDefect = "189,0,188,72";
		let seededDefectFailure;
		await page.goto(`${url}?proof=nested-group&seed=nested-group-red-plus-one`, { waitUntil: "networkidle" });
		const seededPixelOutput = page.getByTestId("nested-group-pixel");
		await seededPixelOutput.waitFor({ state: "visible" });
		const seededPixel = await seededPixelOutput.textContent();
		try {
			assertPixel(seededPixel, expected);
		} catch (error) {
			seededDefectFailure = error.message;
		}
		if (!seededDefectFailure || seededPixel !== seededDefect) {
			throw new Error(`Nested-group seeded defect did not reach the oracle: expected ${seededDefect}, got ${seededPixel}`);
		}
		if (errors.length > 0) {
			throw new Error(`Nested-group page errors: ${[...new Set(errors)].join("; ")}`);
		}
		return {
			browser: `Chromium ${browser.version()}`,
			backend,
			uiPackageVersion,
			sortableTreeNodes,
			installedCorePixel: installedCorePixel.split(",").map(Number),
			installedCoreSeededDefectRejected: installedCoreSeededPixel.split(",").map(Number),
			pixel: pixel.split(",").map(Number),
			nonzeroOutput: true,
			seededDefectRejected: seededPixel.split(",").map(Number),
			seededDefectFailure
		};
	} finally {
		await context.close();
	}
}

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
server.unref();
const address = server.address();
if (!address || typeof address === "string") {
	throw new Error("Editor server failed to start");
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "three-compositor-editor-"));
const persistenceImagePath = path.join(temporaryDirectory, "persistence-proof.png");
await writeFile(
	persistenceImagePath,
	Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbYkWQAAAABJRU5ErkJggg==", "base64")
);
const accessibilityMatrix = process.argv.includes("--accessibility-matrix");
const browser = accessibilityMatrix ? null : await chromium.launch(chromiumLaunchOptions({ headless: true, args: chromiumGpuArguments }));
try {
	const url = `http://127.0.0.1:${address.port}/`;
	const maskKeyboardOnly = process.argv.includes("--mask-keyboard-only");
	const viewportReopenOnly = process.argv.includes("--viewport-reopen-only");
	const nestedGroupOnly = process.argv.includes("--nested-group-only");
	if (accessibilityMatrix) {
		const results = [];
		for (const [name, browserType, launchOptions] of [
				["Chromium", chromium, chromiumLaunchOptions({ headless: true, args: chromiumGpuArguments })],
			["Firefox", firefox, { headless: true }]
		]) {
			const matrixBrowser = await browserType.launch(launchOptions);
			try {
				await runMaskKeyboardJourney(matrixBrowser, url);
				results.push({ name, ...await runAccessibilityScan(matrixBrowser, url) });
			} finally {
				await matrixBrowser.close();
			}
		}
		console.log(`three compositor accessibility matrix passed: ${JSON.stringify(results)}`);
	} else if (nestedGroupOnly) {
		const nestedGroup = await runNestedGroupProof(browser, url);
		console.log(`three compositor editor proof passed: nested group; ${JSON.stringify(nestedGroup)}`);
	} else if (maskKeyboardOnly) {
		await runMaskKeyboardJourney(browser, url);
		console.log("three compositor editor proof passed: keyboard-only mask journey in Chromium");
	} else {
		const viewportReopen = await runViewportReopen(browser, url, persistenceImagePath);
		if (viewportReopenOnly) {
			console.log(`three compositor editor proof passed: viewport reopen; ${JSON.stringify(viewportReopen)}`);
		} else {
			await runMaskKeyboardJourney(browser, url);
			await runDesktop(browser, url, path.join(temporaryDirectory, "editor-document.json"), path.join(temporaryDirectory, "night-market.psd"));
			await runMobile(browser, url);
			console.log(`three compositor editor proof passed: viewport reopen, keyboard mask journey, desktop 1440x900, mobile 390x844; ${JSON.stringify(viewportReopen)}`);
		}
	}
} finally {
	await browser?.close();
	await rm(temporaryDirectory, { recursive: true, force: true });
	server.close();
	server.closeAllConnections();
}

import { compositeRgba8, type CompositeRgba8Layer } from '../../src/model/compositor-blend';
import {
	COMPOSITOR_PACKAGE_VERSION,
	THREE_COMPOSITOR_RUNTIME_VERSION,
	ThreeCompositor,
	type CompositorLayer
} from '../../src/rendering/compositor/three-compositor';
import compositionFixture from './fixtures/composition-full-v1.json';

const WIDTH = 4;
const HEIGHT = 3;
const PIXEL_COUNT = WIDTH * HEIGHT;

const REQUIRED_FEATURES = ['cpu', 'webgpu', 'webgl2', 'groups', 'masks', 'rotation', 'clipping', 'adjustments'] as const;

function validateCompositionFixture(): void {
	if (compositionFixture.schema !== 'ch5.image-editor.composition-fixture.v1' || compositionFixture.id !== 'composition-full-v1') {
		throw new Error('Invalid composition-full-v1 fixture identity');
	}
	for (const feature of REQUIRED_FEATURES) {
		if (!compositionFixture.axes.includes(feature)) {
			throw new Error(`composition-full-v1 missing required axis: ${feature}`);
		}
	}
	if (compositionFixture.pixelContract.rgba8.maxChannelDelta !== 3 || compositionFixture.pixelContract.rgba8.signedMeanBias !== 0.25) {
		throw new Error('composition-full-v1 RGBA8 contract drifted');
	}
	const unsupportedCodes = new Set(compositionFixture.unsupported.map(entry => entry.code));
	for (const code of ['E_GROUP_MASK_UNSUPPORTED', 'E_ADJUSTMENT_MASK_UNSUPPORTED', 'E_CLIPPED_GROUP_UNSUPPORTED']) {
		if (!unsupportedCodes.has(code)) {
			throw new Error(`composition-full-v1 missing typed unsupported code: ${code}`);
		}
	}
	for (const scenario of compositionFixture.scenarios) {
		for (const backend of ['cpu', 'webgpu', 'webgl2']) {
			if (!scenario.backends.includes(backend)) {
				throw new Error(`${scenario.id} missing backend evidence: ${backend}`);
			}
		}
		for (const feature of ['groups', 'masks', 'rotation', 'clipping', 'adjustments']) {
			if (!scenario.features.includes(feature)) {
				throw new Error(`${scenario.id} missing feature evidence: ${feature}`);
			}
		}
	}
}

validateCompositionFixture();

const rgba = (values: Array<number>): Uint8ClampedArray => new Uint8ClampedArray(values);

const bottomPixels = rgba([
	18, 42, 160, 255, 18, 42, 160, 255, 18, 42, 160, 255, 18, 42, 160, 0,
	220, 180, 40, 255, 220, 180, 40, 255, 220, 180, 40, 128, 220, 180, 40, 0,
	34, 180, 96, 255, 32, 180, 96, 255, 32, 180, 96, 64, 32, 180, 96, 0
]);
const middlePixels = rgba([
	230, 44, 24, 255, 230, 44, 24, 192, 230, 44, 24, 128, 230, 44, 24, 64,
	44, 220, 210, 255, 44, 220, 210, 192, 44, 220, 210, 128, 44, 220, 210, 64,
	170, 60, 220, 255, 170, 60, 220, 192, 170, 60, 220, 128, 170, 60, 220, 0
]);
const topPixels = rgba([
	250, 250, 250, 0, 250, 250, 250, 32, 250, 250, 250, 96, 250, 250, 250, 160,
	80, 120, 250, 0, 80, 120, 250, 64, 80, 120, 250, 128, 80, 120, 250, 192,
	250, 100, 60, 0, 250, 100, 60, 96, 250, 100, 60, 192, 250, 100, 60, 255
]);
const middleMask = new Uint8ClampedArray([0, 32, 96, 255, 255, 160, 80, 0, 24, 128, 220, 255]);

function canvasFromPixels(pixels: Uint8ClampedArray): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas 2D unavailable');
	}
	context.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
	return canvas;
}

function maskCanvas(mask: Uint8ClampedArray): HTMLCanvasElement {
	const pixels = new Uint8ClampedArray(PIXEL_COUNT * 4);
	for (let index = 0; index < PIXEL_COUNT; index += 1) {
		pixels.set([mask[index], mask[index], mask[index], 255], index * 4);
	}
	return canvasFromPixels(pixels);
}

const sources = {
	bottom: canvasFromPixels(bottomPixels),
	middle: canvasFromPixels(middlePixels),
	top: canvasFromPixels(topPixels)
};
const mask = maskCanvas(middleMask);

function gpuLayers(): Array<CompositorLayer> {
	return [
		{ id: 'bottom', source: sources.bottom, opacity: 1, blendMode: 'normal', visible: true },
		{ id: 'middle', source: sources.middle, opacity: 0.63, blendMode: 'multiply', mask, visible: true },
		{ id: 'top', source: sources.top, opacity: 0.71, blendMode: 'screen', visible: true }
	];
}

function cpuLayers(order = ['bottom', 'middle', 'top']): Array<CompositeRgba8Layer> {
	const layers: Record<string, CompositeRgba8Layer> = {
		bottom: { pixels: bottomPixels, opacity: 1, mode: 'normal' },
		middle: { pixels: middlePixels, opacity: 0.63, mask: middleMask, mode: 'multiply' },
		top: { pixels: topPixels, opacity: 0.71, mode: 'screen' }
	};
	return order.map(id => layers[id]);
}

async function readScenario(forceWebGL: boolean, reordered: boolean, warm = false) {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	document.body.append(canvas);
	const compositor = await ThreeCompositor.create({ canvas, layers: gpuLayers(), forceWebGL, pixelRatio: 1 });
	try {
		if (warm) {
			compositor.render();
		}
		if (reordered) {
			compositor.reorderLayers(['bottom', 'top', 'middle']);
			compositor.updateLayer('middle', { opacity: 0.47 });
		}
		compositor.render();
		const expectedLayers = cpuLayers(reordered ? ['bottom', 'top', 'middle'] : undefined);
		if (reordered) {
			expectedLayers[2].opacity = 0.47;
		}
		const actual = [...(await compositor.readPixels())];
		return {
			backend: compositor.backend,
			actual,
			expected: [...compositeRgba8(WIDTH, HEIGHT, expectedLayers)],
			nonzeroOutput: actual.some(value => value !== 0),
			identity: {
				packageVersion: COMPOSITOR_PACKAGE_VERSION,
				runtimeVersion: THREE_COMPOSITOR_RUNTIME_VERSION
			}
		};
	} finally {
		compositor.destroy();
		canvas.remove();
	}
}

async function readContextLossScenario() {
	let canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	document.body.append(canvas);
	const failures: Array<string> = [];
	const lost = Promise.withResolvers<void>();
	let compositor = await ThreeCompositor.create({
		canvas,
		layers: gpuLayers(),
		forceWebGL: true,
		pixelRatio: 1,
		onFailure: failure => {
			failures.push(`${failure.kind}:${failure.message}`);
			lost.resolve();
		}
	});
	try {
		compositor.render();
		const beforeLoss = compositor.getTextureUploadSnapshot();
		const context = canvas.getContext('webgl2');
		const extension = context?.getExtension('WEBGL_lose_context');
		if (!extension) {
			throw new Error('WEBGL_lose_context unavailable');
		}
		extension.loseContext();
		const timeout = Promise.withResolvers<never>();
		setTimeout(() => timeout.reject(new Error('WebGL context loss callback timed out')), 2000);
		await Promise.race([lost.promise, timeout.promise]);
		await new Promise(resolve => setTimeout(resolve, 0));
		let renderRejected = false;
		try {
			compositor.render();
		} catch {
			renderRejected = true;
		}
		compositor.destroy();
		canvas.remove();
		canvas = document.createElement('canvas');
		canvas.width = WIDTH;
		canvas.height = HEIGHT;
		document.body.append(canvas);
		compositor = await ThreeCompositor.create({ canvas, layers: gpuLayers(), forceWebGL: true, pixelRatio: 1 });
		compositor.render();
		const pixels = await compositor.readPixels();
		return {
			failures,
			renderRejected,
			restoredGeneration: 1,
			beforeLoss,
			afterRestore: compositor.getTextureUploadSnapshot(),
			nonzeroOutput: pixels.some(value => value !== 0),
			identity: {
				packageVersion: COMPOSITOR_PACKAGE_VERSION,
				runtimeVersion: THREE_COMPOSITOR_RUNTIME_VERSION
			}
		};
	} finally {
		compositor.destroy();
		canvas.remove();
	}
}

async function readTextureUploadScenario() {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	document.body.append(canvas);
	const layers = gpuLayers();
	const compositor = await ThreeCompositor.create({ canvas, layers, forceWebGL: true, pixelRatio: 1 });
	try {
		compositor.render();
		const initial = compositor.getTextureUploadSnapshot();
		compositor.render();
		const unchanged = compositor.getTextureUploadSnapshot();

		const topContext = sources.top.getContext('2d');
		if (!topContext) {
			throw new Error('Top source context unavailable');
		}
		topContext.fillStyle = 'rgba(20, 220, 80, 1)';
		topContext.fillRect(0, 0, 1, 1);
		compositor.updateLayer('top', { sourceRevision: 1 });
		compositor.render();
		const afterSource = compositor.getTextureUploadSnapshot();

		const maskContext = mask.getContext('2d');
		if (!maskContext) {
			throw new Error('Mask context unavailable');
		}
		maskContext.fillStyle = 'white';
		maskContext.fillRect(0, 0, 1, 1);
		compositor.updateLayer('middle', { maskRevision: 1 });
		compositor.render();
		const pixels = await compositor.readPixels();
		return {
			initial,
			unchanged,
			afterSource,
			afterMask: compositor.getTextureUploadSnapshot(),
			nonzeroOutput: pixels.some(value => value !== 0),
			identity: {
				packageVersion: COMPOSITOR_PACKAGE_VERSION,
				runtimeVersion: THREE_COMPOSITOR_RUNTIME_VERSION
			}
		};
	} finally {
		compositor.destroy();
		canvas.remove();
	}
}

window.runThreeCompositorScenario = async (forceWebGL: boolean, scenario: 'base' | 'reordered' | 'context-loss' | 'texture-uploads') =>
	scenario === 'context-loss' ? readContextLossScenario() : (scenario === 'texture-uploads' ? readTextureUploadScenario() : readScenario(forceWebGL, scenario === 'reordered', scenario === 'reordered'));

window.compositionFixtureContract = {
	id: compositionFixture.id,
	axes: [...compositionFixture.axes],
	unsupported: compositionFixture.unsupported.map(entry => entry.code),
	scenarios: compositionFixture.scenarios.map(scenario => ({
		id: scenario.id,
		backends: [...scenario.backends],
		features: [...scenario.features]
	}))
};

declare global {
	interface Window {
		compositionFixtureContract: {
			id: string;
			axes: Array<string>;
			unsupported: Array<string>;
			scenarios: Array<{
				id: string;
				backends: Array<string>;
				features: Array<string>;
			}>;
		};
		runThreeCompositorScenario(forceWebGL: boolean, scenario: 'base' | 'reordered'): Promise<{
			backend: string;
			actual: Array<number>;
			expected: Array<number>;
			nonzeroOutput: boolean;
			identity: { packageVersion: string; runtimeVersion: string };
		}>;
		runThreeCompositorScenario(forceWebGL: boolean, scenario: 'context-loss'): Promise<{
			failures: Array<string>;
			renderRejected: boolean;
			restoredGeneration: number;
			beforeLoss: { source: number; mask: number; total: number };
			afterRestore: { source: number; mask: number; total: number };
			nonzeroOutput: boolean;
			identity: { packageVersion: string; runtimeVersion: string };
		}>;
		runThreeCompositorScenario(forceWebGL: boolean, scenario: 'texture-uploads'): Promise<{
			initial: { source: number; mask: number; total: number };
			unchanged: { source: number; mask: number; total: number };
			afterSource: { source: number; mask: number; total: number };
			afterMask: { source: number; mask: number; total: number };
			nonzeroOutput: boolean;
			identity: { packageVersion: string; runtimeVersion: string };
		}>;
	}
}

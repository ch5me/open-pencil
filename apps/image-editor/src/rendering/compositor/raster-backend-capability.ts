export const OPEN_PENCIL_RASTER_BACKEND_CONTRACT_VERSION = 'open-pencil-raster-backend-v1';

export type OpenPencilRasterBackend = 'canvas2d' | 'webgl2' | 'webgpu' | 'backend-unavailable';
export type RasterPixelContract = 'rgba8-cpu' | 'rgba8-consuming-readback' | 'none';
export type RasterEquivalence = 'non-equivalent' | 'conditional' | 'unavailable';

export interface OpenPencilRasterBackendCapability {
	readonly backend: OpenPencilRasterBackend;
	readonly execution: 'fallback' | 'gpu' | 'unavailable';
	readonly pixelContract: RasterPixelContract;
	readonly equivalence: RasterEquivalence;
	readonly supportsRgba8Readback: boolean;
	readonly warningCode?: 'E_RENDER_BACKEND_NON_EQUIVALENT';
}

const CAPABILITIES: Readonly<Record<OpenPencilRasterBackend, OpenPencilRasterBackendCapability>> = {
	'canvas2d': {
		backend: 'canvas2d',
		execution: 'fallback',
		pixelContract: 'rgba8-cpu',
		equivalence: 'non-equivalent',
		supportsRgba8Readback: true,
		warningCode: 'E_RENDER_BACKEND_NON_EQUIVALENT'
	},
	'webgl2': {
		backend: 'webgl2',
		execution: 'gpu',
		pixelContract: 'rgba8-consuming-readback',
		equivalence: 'conditional',
		supportsRgba8Readback: true
	},
	'webgpu': {
		backend: 'webgpu',
		execution: 'gpu',
		pixelContract: 'rgba8-consuming-readback',
		equivalence: 'conditional',
		supportsRgba8Readback: true
	},
	'backend-unavailable': {
		backend: 'backend-unavailable',
		execution: 'unavailable',
		pixelContract: 'none',
		equivalence: 'unavailable',
		supportsRgba8Readback: false
	}
} as const;

export class RasterBackendUnavailableError extends Error {
	readonly code = 'E_CAPABILITY_RASTER_BACKEND_UNAVAILABLE';

	constructor() {
		super('OpenPencil raster backend is unavailable');
		this.name = 'RasterBackendUnavailableError';
	}
}

export function describeOpenPencilRasterBackend(
	backend: OpenPencilRasterBackend
): OpenPencilRasterBackendCapability {
	return CAPABILITIES[backend];
}

export function requireOpenPencilRasterBackend(
	backend: OpenPencilRasterBackend
): Exclude<OpenPencilRasterBackend, 'backend-unavailable'> {
	if (backend === 'backend-unavailable') {
		throw new RasterBackendUnavailableError();
	}
	return backend;
}

export function assertOpenPencilRasterEquivalence(
	backend: OpenPencilRasterBackend,
	claimed: 'equivalent' | 'non-equivalent'
): void {
	const capability = describeOpenPencilRasterBackend(backend);
	if (claimed === 'equivalent' && capability.equivalence !== 'conditional') {
		throw new Error(`Backend ${backend} cannot claim RGBA8 equivalence`);
	}
	if (claimed === 'non-equivalent' && capability.equivalence === 'conditional') {
		throw new Error(`Backend ${backend} requires consuming pixel evidence before non-equivalence is declared`);
	}
}

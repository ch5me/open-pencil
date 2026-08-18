import {
	COMPOSITOR_PACKAGE_VERSION,
	type CompositorModule
} from '../rendering/compositor';

export const EXPECTED_THREE_COMPOSITOR_RUNTIME_VERSION = 'three-compositor-v1';
export const EXPECTED_COMPOSITOR_PACKAGE_VERSION = COMPOSITOR_PACKAGE_VERSION;
export type ThreeCompositorRuntimeModule = CompositorModule;

export class RuntimeVersionMismatchError extends Error {
	readonly code = 'E_RUNTIME_VERSION_MISMATCH';

	constructor(expected: string, actual: unknown) {
		super(`Expected compositor runtime ${expected}; received ${String(actual)}`);
		this.name = 'RuntimeVersionMismatchError';
	}
}

type RuntimeLoader = () => Promise<CompositorModule>;

function assertRuntimeVersion(runtime: CompositorModule, expectedVersion: string): void {
	if (runtime.COMPOSITOR_PACKAGE_VERSION !== EXPECTED_COMPOSITOR_PACKAGE_VERSION) {
		throw new RuntimeVersionMismatchError(expectedVersion, runtime.COMPOSITOR_PACKAGE_VERSION);
	}
	if (runtime.THREE_COMPOSITOR_RUNTIME_VERSION === undefined) {
		return;
	}
	if (runtime.THREE_COMPOSITOR_RUNTIME_VERSION !== expectedVersion) {
		throw new RuntimeVersionMismatchError(expectedVersion, runtime.THREE_COMPOSITOR_RUNTIME_VERSION);
	}
}

export function createDeferredThreeCompositorLoader(
	load: RuntimeLoader = async () => import('../rendering/compositor/three-compositor')
): () => Promise<ThreeCompositorRuntimeModule> {
	let pending: Promise<ThreeCompositorRuntimeModule> | undefined;
	// Return the exact shared promise so concurrent callers share one chunk request.
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	return () => {
		pending ??= load();
		return pending;
	};
}

const deferredRuntimeLoader = createDeferredThreeCompositorLoader();

export async function loadThreeCompositor(
	load: RuntimeLoader = deferredRuntimeLoader,
	expectedVersion = EXPECTED_THREE_COMPOSITOR_RUNTIME_VERSION
): Promise<ThreeCompositorRuntimeModule> {
	const runtime = await load();
	assertRuntimeVersion(runtime, expectedVersion);
	return runtime;
}

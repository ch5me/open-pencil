import { describe, expect, it } from 'vitest';
import {
	EXPECTED_THREE_COMPOSITOR_RUNTIME_VERSION,
	RuntimeVersionMismatchError,
	createDeferredThreeCompositorLoader,
	loadThreeCompositor
} from './runtime-loader';

describe('three compositor runtime loader', () => {
	it('defers the chunk request until first use and shares the pending request', async () => {
		let loads = 0;
		const runtime = await import('../rendering/compositor/three-compositor');
		const deferred = createDeferredThreeCompositorLoader(async () => {
			loads += 1;
			return runtime;
		});

		expect(loads).toBe(0);
		const first = deferred();
		const second = deferred();
		expect(loads).toBe(1);
		await expect(first).resolves.toBe(runtime);
		await expect(second).resolves.toBe(runtime);
	});

	it('loads the compatibility compositor through the local chunk', async () => {
		let loads = 0;
		const runtime = await loadThreeCompositor(async () => {
			loads += 1;
			return import('../rendering/compositor/three-compositor');
		});

		expect(loads).toBe(1);
		expect(runtime.THREE_COMPOSITOR_RUNTIME_VERSION).toBe(EXPECTED_THREE_COMPOSITOR_RUNTIME_VERSION);
	});

	it('rejects a mixed-version runtime before exposing the compositor', async () => {
		const current = await import('../rendering/compositor/three-compositor');
		const stale = {
			...current,
			THREE_COMPOSITOR_RUNTIME_VERSION: 'three-compositor-v0'
		};

		await expect(loadThreeCompositor(async () => stale)).rejects.toMatchObject({
			name: 'RuntimeVersionMismatchError',
			code: 'E_RUNTIME_VERSION_MISMATCH'
		} satisfies Partial<RuntimeVersionMismatchError>);
	});

	it('rejects a mixed-version compositor package before mounting', async () => {
		const current = await import('../rendering/compositor/three-compositor');
		const stale = {
			...current,
			COMPOSITOR_PACKAGE_VERSION: 'compositor-package-v0'
		};

		await expect(loadThreeCompositor(async () => stale)).rejects.toMatchObject({
			name: 'RuntimeVersionMismatchError',
			code: 'E_RUNTIME_VERSION_MISMATCH'
		} satisfies Partial<RuntimeVersionMismatchError>);
	});
});

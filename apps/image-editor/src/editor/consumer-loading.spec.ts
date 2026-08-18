import { describe, expect, it, vi } from 'vitest';
import {
	createConsumerCompositorRecoveryController,
	createDeferredConsumerCompositor,
	loadConsumerCompositor,
	type ConsumerCompositor,
	type ConsumerCompositorModule
} from './consumer-loading';

function moduleFor(compositor: Awaited<ReturnType<ConsumerCompositorModule['ThreeCompositor']['create']>>): ConsumerCompositorModule {
	return {
		COMPOSITOR_PACKAGE_VERSION: 'compositor-package-v1',
		ThreeCompositor: { create: vi.fn(async () => compositor) }
	};
}

const loadOptions = { canvas: {} as HTMLCanvasElement };
const recoveryOptions = {};

function compositor(backend: ConsumerCompositor['backend'] = 'webgl2'): ConsumerCompositor {
	return {
		backend,
		setLayers: vi.fn(),
		resize: vi.fn(),
		render: vi.fn(),
		destroy: vi.fn()
	};
}

describe('consumer compositor loading', () => {
	it('loads the Three compositor through the consumer-owned seam', async () => {
		const compositor = {
			backend: 'webgl2' as const,
			setLayers: vi.fn(),
			resize: vi.fn(),
			render: vi.fn(),
			destroy: vi.fn()
		};
		const importer = vi.fn(async () => moduleFor(compositor as unknown as Awaited<ReturnType<ConsumerCompositorModule['ThreeCompositor']['create']>>));

		await expect(loadConsumerCompositor(loadOptions, importer)).resolves.toBe(compositor);
		expect(importer).toHaveBeenCalledOnce();
	});

	it('fails loudly when the loaded module has no compositor factory', async () => {
		const importer = vi.fn(async () => ({ ThreeCompositor: {} } as unknown as ConsumerCompositorModule));

		await expect(loadConsumerCompositor(loadOptions, importer))
			.rejects.toThrow('Three compositor consumer module is unavailable');
	});

	it('preserves importer and factory failures for the fallback consumer', async () => {
		const cause = new Error('chunk unavailable');
		const importer = vi.fn(async () => {
			throw cause;
		});

		await expect(loadConsumerCompositor(loadOptions, importer)).rejects.toBe(cause);
	});

	it('preserves compositor factory failures for the fallback consumer', async () => {
		const cause = new Error('renderer unavailable');
		const importer = vi.fn(async () => ({
			ThreeCompositor: {
				create: vi.fn(async () => {
					throw cause;
				})
			}
		} as unknown as ConsumerCompositorModule));

		await expect(loadConsumerCompositor(loadOptions, importer)).rejects.toBe(cause);
	});

	it('defers the import until requested and shares the in-flight load', async () => {
		const compositor = {
			backend: 'webgl2' as const,
			setLayers: vi.fn(),
			resize: vi.fn(),
			render: vi.fn(),
			destroy: vi.fn()
		};
		const importer = vi.fn(async () => moduleFor(compositor as unknown as Awaited<ReturnType<ConsumerCompositorModule['ThreeCompositor']['create']>>));
		const load = createDeferredConsumerCompositor(loadOptions, importer);

		expect(importer).not.toHaveBeenCalled();
		const first = load();
		const second = load();
		await expect(first).resolves.toBe(compositor);
		await expect(second).resolves.toBe(compositor);
		expect(first).toBe(second);
		expect(importer).toHaveBeenCalledOnce();
	});

	it('keeps failed imports observable to the deferred caller', async () => {
		const cause = new Error('runtime unavailable');
		const load = createDeferredConsumerCompositor(loadOptions, async () => {
			throw cause;
		});

		await expect(load()).rejects.toBe(cause);
	});

	it('shares a rejected deferred load without retrying the importer', async () => {
		const cause = new Error('runtime unavailable');
		const importer = vi.fn(async () => {
			throw cause;
		});
		const load = createDeferredConsumerCompositor(loadOptions, importer);

		const first = load();
		const second = load();
		await expect(first).rejects.toBe(cause);
		await expect(second).rejects.toBe(cause);
		expect(first).toBe(second);
		expect(importer).toHaveBeenCalledOnce();
	});

	it('serializes 20 recovery cycles without retaining compositor instances', async () => {
		const instances: Array<ConsumerCompositor> = [];
		const failures: Array<(failure: { kind: 'context-lost'; message: string }) => void> = [];
		const canvases = Array.from({ length: 21 }, (_, generation) => ({ generation } as unknown as HTMLCanvasElement));
		const createdCanvases: Array<HTMLCanvasElement> = [];
		let canvasGeneration = 0;
		let activeFactories = 0;
		let maxActiveFactories = 0;
		let revision = 0;
		const importer = vi.fn(async () => ({
			COMPOSITOR_PACKAGE_VERSION: 'compositor-package-v1',
			ThreeCompositor: {
				create: vi.fn(async createOptions => {
					activeFactories += 1;
					maxActiveFactories = Math.max(maxActiveFactories, activeFactories);
					await Promise.resolve();
					activeFactories -= 1;
					createdCanvases.push(createOptions.canvas);
					const next = compositor();
					instances.push(next);
					failures.push(createOptions.onFailure as typeof failures[number]);
					return next;
				})
			}
		} as unknown as ConsumerCompositorModule));
		const published: Array<{ compositor: ConsumerCompositor; generation: number }> = [];
		const controller = createConsumerCompositorRecoveryController({
			options: recoveryOptions,
			canvas: {
				get current() {
					return canvases[canvasGeneration]!;
				},
				replace: vi.fn(async () => canvases[++canvasGeneration]!)
			},
			requestedBackend: 'webgl2',
			importer,
			snapshot: () => ({
				layers: [{
					id: `layer-${revision}`,
					source: {} as HTMLCanvasElement,
					opacity: 1,
					blendMode: 'normal',
					visible: true
				}],
				width: 100 + revision,
				height: 200 + revision
			}),
			onPublish: (next, generation) => {
				published.push({ compositor: next, generation });
			}
		});

		await controller.ensure();
		for (let cycle = 1; cycle <= 20; cycle += 1) {
			revision = cycle;
			failures[cycle - 1]?.({ kind: 'context-lost', message: `loss ${cycle}` });
			await vi.waitFor(() => expect(controller.generation).toBe(cycle));
			await controller.ensure();
		}

		expect(maxActiveFactories).toBe(1);
		expect(instances).toHaveLength(21);
		expect(createdCanvases).toEqual(canvases);
		expect(new Set(createdCanvases).size).toBe(21);
		expect(canvasGeneration).toBe(20);
		expect(published.map(({ generation }) => generation)).toEqual(Array.from({ length: 21 }, (_, index) => index));
		expect(controller.current).toBe(instances.at(-1));
		for (const [index, instance] of instances.entries()) {
			expect(instance.destroy).toHaveBeenCalledTimes(index === instances.length - 1 ? 0 : 1);
			expect(instance.setLayers).toHaveBeenLastCalledWith([expect.objectContaining({ id: `layer-${index}` })]);
			expect(instance.resize).toHaveBeenLastCalledWith(100 + index, 200 + index);
			expect(instance.render).toHaveBeenCalledOnce();
		}

		controller.destroy();
		expect(instances.at(-1)?.destroy).toHaveBeenCalledOnce();
		expect(controller.current).toBeNull();
	});

	it('rejects a recovered backend downgrade and destroys the unpublished instance', async () => {
		const first = compositor('webgpu');
		const downgraded = compositor('webgl2');
		const create = vi.fn()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(downgraded);
		const controller = createConsumerCompositorRecoveryController({
			options: recoveryOptions,
			canvas: {
				current: {} as HTMLCanvasElement,
				replace: async () => ({} as HTMLCanvasElement)
			},
			requestedBackend: 'webgpu',
			importer: async () => ({
				COMPOSITOR_PACKAGE_VERSION: 'compositor-package-v1',
				ThreeCompositor: { create }
			} as unknown as ConsumerCompositorModule),
			snapshot: () => ({ layers: [], width: 1, height: 1 })
		});

		await controller.ensure();
		await expect(controller.recover({ kind: 'device-lost', message: 'lost' }))
			.rejects.toThrow('Requested compositor backend webgpu, got webgl2');
		expect(first.destroy).toHaveBeenCalledOnce();
		expect(downgraded.destroy).toHaveBeenCalledOnce();
		expect(controller.current).toBeNull();
	});

	it('destroys a candidate when publish throws without exposing it as current', async () => {
		const candidate = compositor();
		const controller = createConsumerCompositorRecoveryController({
			options: recoveryOptions,
			canvas: {
				current: {} as HTMLCanvasElement,
				replace: async () => ({} as HTMLCanvasElement)
			},
			importer: async () => moduleFor(candidate as unknown as Awaited<ReturnType<ConsumerCompositorModule['ThreeCompositor']['create']>>),
			snapshot: () => ({ layers: [], width: 1, height: 1 }),
			onPublish: () => {
				throw new Error('publish failed');
			}
		});

		await expect(controller.ensure()).rejects.toThrow('publish failed');
		expect(candidate.destroy).toHaveBeenCalledOnce();
		expect(controller.current).toBeNull();
	});

	it('waits for the committed replacement canvas before factory creation', async () => {
		const initial = { generation: 0 } as unknown as HTMLCanvasElement;
		const committed = { generation: 1 } as unknown as HTMLCanvasElement;
		let commitCanvas!: (canvas: HTMLCanvasElement) => void;
		// Promise.withResolvers is not in this spike's configured TypeScript library.
		// eslint-disable-next-line unicorn/prefer-promise-with-resolvers
		const replacement = new Promise<HTMLCanvasElement>(resolve => {
			commitCanvas = resolve;
		});
		const createdCanvases: Array<HTMLCanvasElement> = [];
		const create = vi.fn(async (
			options: Parameters<ConsumerCompositorModule['ThreeCompositor']['create']>[0]
		) => {
			createdCanvases.push(options.canvas);
			return compositor();
		});
		const controller = createConsumerCompositorRecoveryController({
			options: recoveryOptions,
			canvas: {
				current: initial,
				replace: async () => replacement
			},
			importer: async () => ({
				COMPOSITOR_PACKAGE_VERSION: 'compositor-package-v1',
				ThreeCompositor: { create }
			} as unknown as ConsumerCompositorModule),
			snapshot: () => ({ layers: [], width: 1, height: 1 })
		});

		await controller.ensure();
		const recovery = controller.recover({ kind: 'context-lost', message: 'lost' });
		await Promise.resolve();
		expect(create).toHaveBeenCalledTimes(1);

		commitCanvas(committed);
		await recovery;
		expect(create).toHaveBeenCalledTimes(2);
		expect(createdCanvases).toEqual([initial, committed]);
	});
});

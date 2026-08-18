import type {
	Compositor,
	CompositorFailure,
	CompositorLayer,
	CompositorOptions,
	CompositorModule
} from '../rendering/compositor';
import { loadThreeCompositor } from './runtime-loader';

export type ConsumerCompositor = Pick<Compositor, 'backend' | 'setLayers' | 'resize' | 'render' | 'destroy'>;
export type ConsumerCompositorModule = CompositorModule;
export type ConsumerCompositorImporter = () => Promise<ConsumerCompositorModule>;

export interface ConsumerCompositorSnapshot {
	layers: Array<CompositorLayer>;
	width: number;
	height: number;
}

export interface ConsumerCompositorCanvas {
	readonly current: HTMLCanvasElement;
	replace(): Promise<HTMLCanvasElement>;
}

export interface ConsumerCompositorRecoveryOptions {
	options: Omit<CompositorOptions, 'canvas' | 'layers' | 'onFailure'>;
	canvas: ConsumerCompositorCanvas;
	snapshot: () => ConsumerCompositorSnapshot;
	importer?: ConsumerCompositorImporter;
	requestedBackend?: ConsumerCompositor['backend'];
	onFailure?: (failure: CompositorFailure) => void;
	onPublish?: (compositor: ConsumerCompositor, generation: number) => void;
}

export interface ConsumerCompositorRecoveryController {
	readonly current: ConsumerCompositor | null;
	readonly generation: number;
	ensure(): Promise<ConsumerCompositor>;
	recover(failure: CompositorFailure): Promise<ConsumerCompositor>;
	destroy(): void;
}

export async function importConsumerCompositor(): Promise<CompositorModule> {
	return loadThreeCompositor();
}

export async function loadConsumerCompositor(
	options: CompositorOptions,
	importer: ConsumerCompositorImporter = importConsumerCompositor
): Promise<ConsumerCompositor> {
	const module = await importer();
	if (!module.ThreeCompositor || typeof module.ThreeCompositor.create !== 'function') {
		throw new Error('Three compositor consumer module is unavailable');
	}
	return module.ThreeCompositor.create(options);
}

export function createDeferredConsumerCompositor(
	options: CompositorOptions,
	importer: ConsumerCompositorImporter = importConsumerCompositor
): () => Promise<ConsumerCompositor> {
	let pending: Promise<ConsumerCompositor> | undefined;
	// Return the exact shared promise so concurrent callers share one chunk request.
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	return () => {
		pending ??= loadConsumerCompositor(options, importer);
		return pending;
	};
}

export function createConsumerCompositorRecoveryController(
	config: ConsumerCompositorRecoveryOptions
): ConsumerCompositorRecoveryController {
	let active: ConsumerCompositor | null = null;
	let activeGeneration = 0;
	let generation = 0;
	let pending: Promise<ConsumerCompositor> | null = null;
	let serial: Promise<void> = Promise.resolve();
	let stopped = false;
	let backend = config.requestedBackend;
	let hasCreated = false;
	const destroyed = new WeakSet<object>();

	const destroyOnce = (compositor: ConsumerCompositor | null): void => {
		if (!compositor || destroyed.has(compositor)) {
			return;
		}
		destroyed.add(compositor);
		compositor.destroy();
	};

	// Return the exact pending promise so concurrent callers share one recovery.
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const start = (): Promise<ConsumerCompositor> => {
		if (stopped) {
			return Promise.reject(new Error('Compositor recovery controller has been destroyed'));
		}
		if (active) {
			return Promise.resolve(active);
		}
		if (pending) {
			return pending;
		}

		const requestedGeneration = generation;
		const operation = serial.then(async () => {
			if (stopped) {
				throw new Error('Compositor recovery controller has been destroyed');
			}
			const initial = config.snapshot();
			const canvas = hasCreated ? await config.canvas.replace() : config.canvas.current;
			hasCreated = true;
			let candidate: ConsumerCompositor | null = null;
			try {
				candidate = await loadConsumerCompositor({
					...config.options,
					canvas,
					layers: initial.layers,
					onFailure: failure => {
						if (requestedGeneration !== generation || stopped) {
							return;
						}
						if (failure.kind === 'renderer-error') {
							config.onFailure?.(failure);
							return;
						}
						restart(failure).catch(error => {
							if (stopped || requestedGeneration + 1 !== generation) {
								return;
							}
							config.onFailure?.({
								kind: 'renderer-error',
								message: error instanceof Error ? error.message : 'Compositor recovery failed',
								cause: error
							});
						});
					}
				}, config.importer);
				if (stopped || requestedGeneration !== generation) {
					throw new Error('Compositor recovery superseded');
				}
				backend ??= candidate.backend;
				if (candidate.backend !== backend) {
					throw new Error(`Requested compositor backend ${backend}, got ${candidate.backend}`);
				}
				const current = config.snapshot();
				candidate.setLayers(current.layers);
				candidate.resize(current.width, current.height);
				candidate.render();
				if (stopped || requestedGeneration !== generation) {
					throw new Error('Compositor recovery superseded');
				}
				config.onPublish?.(candidate, requestedGeneration);
				active = candidate;
				activeGeneration = requestedGeneration;
				return candidate;
			} catch (error) {
				destroyOnce(candidate);
				throw error;
			}
		});
		pending = operation;
		serial = operation.then(() => undefined).catch(() => undefined);
		operation.then(() => {
			if (pending === operation) {
				pending = null;
			}
		}).catch(() => {
			if (pending === operation) {
				pending = null;
			}
		});
		return operation;
	};

	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const restart = (failure: CompositorFailure): Promise<ConsumerCompositor> => {
		if (stopped) {
			return Promise.reject(new Error('Compositor recovery controller has been destroyed'));
		}
		config.onFailure?.(failure);
		generation += 1;
		if (activeGeneration < generation) {
			destroyOnce(active);
			active = null;
			activeGeneration = 0;
		}
		pending = null;
		return start();
	};

	return {
		get current() {
			return active;
		},
		get generation() {
			return generation;
		},
		ensure: start,
		recover: restart,
		destroy() {
			if (stopped) {
				return;
			}
			stopped = true;
			generation += 1;
			destroyOnce(active);
			active = null;
			activeGeneration = 0;
			pending = null;
		}
	};
}

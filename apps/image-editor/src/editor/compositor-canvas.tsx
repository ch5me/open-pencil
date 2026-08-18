import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface CompositorCanvasHandle {
	readonly canvas: HTMLCanvasElement;
	replace(): Promise<HTMLCanvasElement>;
}

interface CompositorCanvasProps {
	width: number;
	height: number;
	hidden: boolean;
	className?: string;
	'data-testid'?: string;
}

interface PendingCanvas {
	generation: number;
	resolve: (canvas: HTMLCanvasElement) => void;
	reject: (error: Error) => void;
}

export const CompositorCanvas = forwardRef<CompositorCanvasHandle, CompositorCanvasProps>(
	({ width, height, hidden, className, 'data-testid': testId = 'compositor-canvas' }, ref) => {
		const canvasRef = useRef<HTMLCanvasElement | null>(null);
		const requestedGenerationRef = useRef(0);
		const pendingRef = useRef<Array<PendingCanvas>>([]);
		const [generation, setGeneration] = useState(0);

		useImperativeHandle(ref, () => ({
			get canvas() {
				const canvas = canvasRef.current;
				if (!canvas) throw new Error('Compositor canvas unavailable');
				return canvas;
			},
			replace() {
				if (!canvasRef.current) return Promise.reject(new Error('Compositor canvas unavailable during recovery'));
				const nextGeneration = requestedGenerationRef.current + 1;
				requestedGenerationRef.current = nextGeneration;
				setGeneration(nextGeneration);
				return new Promise<HTMLCanvasElement>((resolve, reject) => {
					pendingRef.current.push({ generation: nextGeneration, resolve, reject });
				});
			}
		}), []);

		useEffect(() => () => {
			const error = new Error('Compositor canvas unmounted during recovery');
			for (const pending of pendingRef.current.splice(0)) pending.reject(error);
			canvasRef.current = null;
		}, []);

		return (
			<canvas
				key={generation}
				ref={canvas => {
					canvasRef.current = canvas;
					if (!canvas) return;
					const committed = pendingRef.current.filter(pending => pending.generation <= generation);
					pendingRef.current = pendingRef.current.filter(pending => pending.generation > generation);
					for (const pending of committed) pending.resolve(canvas);
				}}
				width={width}
				height={height}
				className={className}
				data-testid={testId}
				hidden={hidden}
			/>
		);
	}
);

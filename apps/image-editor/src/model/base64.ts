export function toBase64(value: string): string {
	return globalThis.btoa(value);
}

export function fromBase64(value: string): string {
	return globalThis.atob(value);
}

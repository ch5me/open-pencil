import type { ContentRevisionId } from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

export async function createContentRevisionId(
  kind: string,
  metadata: Readonly<Record<string, unknown>>,
  bytes: Uint8Array,
): Promise<ContentRevisionId> {
  const header = new TextEncoder().encode(`${kind}\n${JSON.stringify(canonicalize(metadata))}\n`);
  const input = new Uint8Array(header.byteLength + bytes.byteLength);
  input.set(header);
  input.set(bytes, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

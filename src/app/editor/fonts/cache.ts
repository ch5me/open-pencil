import type { DownloadedFontCache } from "@open-pencil/core/text";

import {
  readCacheBytes,
  readCacheJson,
  removeCacheEntry,
  removeCachePrefix,
  renameCacheEntry,
  writeCacheBytes,
  writeCacheJson,
} from "@/app/cache";

type FontCacheEntry = {
  family: string;
  style: string;
  file: string;
  byteLength: number;
  sha256: string;
  updatedAt: number;
};

type FontCacheManifest = {
  version: 1;
  entries: Partial<Record<string, FontCacheEntry>>;
};

export interface DownloadedFontCacheSummary {
  count: number;
  byteLength: number;
  updatedAt: number | null;
}

const CACHE_DIR = "font-cache/v1";
const MANIFEST_PATH = `${CACHE_DIR}/manifest`;
const FILE_DIR = `${CACHE_DIR}/files`;
const EMPTY_MANIFEST: FontCacheManifest = { version: 1, entries: {} };
const textEncoder = new TextEncoder();
let transactionTail = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = transactionTail.then(operation, operation);
  transactionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function cacheKey(family: string, style: string) {
  return hashText(`${family}\0${style}`);
}

async function hashText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return hexDigest(digest);
}

async function hashBytes(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hexDigest(digest);
}

function hexDigest(data: ArrayBuffer) {
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readManifest(): Promise<FontCacheManifest> {
  const manifest = await readCacheJson<Partial<FontCacheManifest>>(MANIFEST_PATH);
  if (manifest?.version !== 1 || !manifest.entries) return EMPTY_MANIFEST;
  return { version: 1, entries: manifest.entries };
}

async function writeManifest(path: string, manifest: FontCacheManifest) {
  await writeCacheJson(path, manifest);
}

async function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function removeFileIfUnreferenced(file: string) {
  const manifest = await readManifest();
  const referenced = Object.values(manifest.entries).some((entry) => entry?.file === file);
  if (!referenced) await removeCacheEntry(`${FILE_DIR}/${file}`);
}

export async function downloadedFontCacheSummary(): Promise<DownloadedFontCacheSummary> {
  return serialize(async () => {
    const manifest = await readManifest();
    const entries = Object.values(manifest.entries).filter(
      (entry): entry is FontCacheEntry => !!entry,
    );
    return {
      count: entries.length,
      byteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
      updatedAt: entries.length > 0 ? Math.max(...entries.map((entry) => entry.updatedAt)) : null,
    };
  });
}

export async function clearDownloadedFontCache(): Promise<void> {
  await serialize(() => removeCachePrefix(CACHE_DIR));
}

export function createTauriDownloadedFontCache(): DownloadedFontCache {
  return {
    async read(family, style) {
      return serialize(async () => {
        const manifest = await readManifest();
        const entry = manifest.entries[await cacheKey(family, style)];
        if (!entry) return null;

        const buffer = await readCacheBytes(`${FILE_DIR}/${entry.file}`);
        if (!buffer) return null;
        if (buffer.byteLength !== entry.byteLength) return null;
        if ((await hashBytes(buffer)) !== entry.sha256) return null;
        return buffer;
      });
    },

    async write(family, style, data, signal) {
      signal?.throwIfAborted();
      const key = await cacheKey(family, style);
      signal?.throwIfAborted();
      const sha256 = await hashBytes(data);
      signal?.throwIfAborted();
      const file = `${key}-${sha256}.ttf`;
      const filePath = `${FILE_DIR}/${file}`;
      await serialize(async () => {
        signal?.throwIfAborted();
        const previousManifest = await readManifest();
        signal?.throwIfAborted();
        const previousEntry = previousManifest.entries[key];
        const manifest: FontCacheManifest = {
          version: 1,
          entries: {
            ...previousManifest.entries,
            [key]: {
              family,
              style,
              file,
              byteLength: data.byteLength,
              sha256,
              updatedAt: Date.now(),
            },
          },
        };
        const stagedManifestPath = `${CACHE_DIR}/manifest-${crypto.randomUUID()}`;

        try {
          await writeCacheBytes(filePath, data);
          signal?.throwIfAborted();
          const stagedWrite = writeManifest(stagedManifestPath, manifest);
          try {
            await waitForAbortable(stagedWrite, signal);
          } catch (error) {
            void stagedWrite.then(
              () => removeCacheEntry(stagedManifestPath),
              () => undefined,
            );
            throw error;
          }
          signal?.throwIfAborted();
          await renameCacheEntry(stagedManifestPath, MANIFEST_PATH);
        } catch (error) {
          await removeCacheEntry(stagedManifestPath);
          await removeFileIfUnreferenced(file);
          throw error;
        }

        if (previousEntry && previousEntry.file !== file) {
          await removeFileIfUnreferenced(previousEntry.file);
        }
      });
    },
  };
}

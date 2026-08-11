import { expect, test } from "bun:test";

import { readFigFile } from "#core/io/formats/fig/read";
import { parsePenFile, readPenFile } from "#core/io/formats/pen/read";
import { IOCancelledError, IOHostileInputError } from "#core/io/limits";
import { IOInputLimitError, IORegistry } from "#core/io/registry";

const oversizedFile = (size: number) => {
  let reads = 0;
  return {
    file: {
      size,
      arrayBuffer: async () => {
        reads += 1;
        return new ArrayBuffer(size);
      },
      text: async () => {
        reads += 1;
        return "{}";
      },
    } as File,
    reads: () => reads,
  };
};

test("hostile-io-v1 rejects JSON before payload allocation", async () => {
  const input = oversizedFile(101);
  await expect(readPenFile(input.file, { maxInputBytes: 100 })).rejects.toThrow(IOInputLimitError);
  expect(input.reads()).toBe(0);
});

test("hostile-io-v1 rejects archive before payload allocation", async () => {
  const input = oversizedFile(101);
  await expect(readFigFile(input.file, { maxInputBytes: 100 })).rejects.toThrow(IOInputLimitError);
  expect(input.reads()).toBe(0);
});

test("IORegistry rejects declared input limit before adapter dispatch", async () => {
  let dispatched = 0;
  const registry = new IORegistry([
    {
      id: "json",
      label: "JSON",
      role: "interchange-document",
      category: "document",
      extensions: ["json"],
      mimeTypes: ["application/json"],
      support: { readDocument: true },
      async readDocument() {
        dispatched += 1;
        throw new Error("should not dispatch");
      },
    },
  ]);

  await expect(
    registry.readDocument(
      { name: "input.json", data: new Uint8Array(101) },
      { maxInputBytes: 100 },
    ),
  ).rejects.toThrow(IOInputLimitError);
  expect(dispatched).toBe(0);
});

function hostileZip(...decodedSizes: number[]): ArrayBuffer {
  const names = decodedSizes.map((_, index) =>
    new TextEncoder().encode(index === 0 ? "canvas" : `images/${index}.png`)
  );
  const localSizes = names.map((name) => 30 + name.length + 1);
  const centralSizes = names.map((name) => 46 + name.length);
  const centralOffset = localSizes.reduce((total, size) => total + size, 0);
  const centralSize = centralSizes.reduce((total, size) => total + size, 0);
  const bytes = new Uint8Array(centralOffset + centralSize + 22);
  const view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  let localOffset = 0;
  let central = centralOffset;
  decodedSizes.forEach((decodedSize, index) => {
    const name = names[index];
    u32(localOffset, 0x04034b50);
    u16(localOffset + 8, 0);
    u16(localOffset + 26, name.length);
    bytes.set(name, localOffset + 30);
    bytes[localOffset + localSizes[index] - 1] = 0;

    u32(central, 0x02014b50);
    u16(central + 10, 0);
    u32(central + 20, 1);
    u32(central + 24, decodedSize);
    u16(central + 28, name.length);
    u32(central + 42, localOffset);
    bytes.set(name, central + 46);
    localOffset += localSizes[index];
    central += centralSizes[index];
  });
  const eocd = centralOffset + centralSize;
  u32(eocd, 0x06054b50);
  u16(eocd + 8, decodedSizes.length);
  u16(eocd + 10, decodedSizes.length);
  u32(eocd + 12, centralSize);
  u32(eocd + 16, centralOffset);
  return bytes.buffer;
}

test("hostile-io-v1 rejects decoded JSON before graph allocation", () => {
  expect(() =>
    parsePenFile("{}", { maxDecodedBytes: 0 }),
  ).toThrow(IOHostileInputError);
});

test("hostile-io-v1 rejects archive expansion before unzip allocation", async () => {
  await expect(
    readFigFile(new File([hostileZip(1024)], "hostile.fig"), {
      maxDecodedBytes: 512,
      maxExpansionRatio: 128,
    }),
  ).rejects.toThrow(IOHostileInputError);
});

test("hostile-io-v1 rejects aggregate archive expansion before unzip allocation", async () => {
  await expect(
    readFigFile(new File([hostileZip(300, 300)], "hostile.fig"), {
      maxDecodedBytes: 512,
      maxExpansionRatio: 128,
    }),
  ).rejects.toThrow(IOHostileInputError);
});

test("hostile-io-v1 preserves typed cancellation before reading JSON", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readPenFile(new File(["{}"], "cancel.pen"), { signal: controller.signal }),
  ).rejects.toThrow(IOCancelledError);
});

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
    } as unknown as File,
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

function hostileZip(decodedSize: number): ArrayBuffer {
  const name = new TextEncoder().encode("canvas");
  const localSize = 30 + name.length + 1;
  const centralSize = 46 + name.length;
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  u32(0, 0x04034b50);
  u16(8, 0);
  u16(26, name.length);
  bytes.set(name, 30);
  bytes[localSize - 1] = 0;
  const central = localSize;
  u32(central, 0x02014b50);
  u16(central + 10, 0);
  u32(central + 20, 1);
  u32(central + 24, decodedSize);
  u16(central + 28, name.length);
  bytes.set(name, central + 46);
  const eocd = central + centralSize;
  u32(eocd, 0x06054b50);
  u16(eocd + 8, 1);
  u16(eocd + 10, 1);
  u32(eocd + 12, centralSize);
  u32(eocd + 16, central);
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

test("hostile-io-v1 preserves typed cancellation before reading JSON", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readPenFile(new File(["{}"], "cancel.pen"), { signal: controller.signal }),
  ).rejects.toThrow(IOCancelledError);
});

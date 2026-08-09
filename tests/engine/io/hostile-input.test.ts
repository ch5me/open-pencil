import { expect, test } from "bun:test";

import { readFigFile } from "#core/io/formats/fig/read";
import { readPenFile } from "#core/io/formats/pen/read";
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

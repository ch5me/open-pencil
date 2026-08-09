import { describe, expect, test } from "bun:test";

import {
  CompositionUnsupportedClassError,
  createCompositionPlan,
  serializeCompositionPlan,
} from "#core/canvas/composition";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

function graphOf(nodes: SceneNode[], rootId: string): SceneGraph {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    rootId,
    getNode: (id: string) => byId.get(id),
  } as unknown as SceneGraph;
}

function node(overrides: Partial<SceneNode> & Pick<SceneNode, "id" | "type">): SceneNode {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.name ?? overrides.id,
    parentId: overrides.parentId ?? null,
    childIds: overrides.childIds ?? [],
    visible: overrides.visible ?? true,
    opacity: overrides.opacity ?? 1,
    blendMode: overrides.blendMode ?? "NORMAL",
    clipsContent: overrides.clipsContent ?? false,
    rotation: overrides.rotation ?? 0,
    isMask: overrides.isMask ?? false,
    maskType: overrides.maskType ?? "ALPHA",
    maskIsOutline: overrides.maskIsOutline ?? false,
    fills: overrides.fills ?? [],
  } as SceneNode;
}

describe("editor composition plan", () => {
  test("captures inherited visibility, opacity, clipping, masks, and rotation", () => {
    const frame = node({
      id: "frame",
      type: "FRAME",
      opacity: 0.5,
      clipsContent: true,
      blendMode: "PASS_THROUGH",
      rotation: 15,
    });
    const child = node({ id: "child", type: "RECTANGLE", parentId: frame.id, opacity: 0.4 });
    const plan = createCompositionPlan(
      graphOf([{ ...frame, childIds: [child.id] }, child], frame.id),
      frame.id,
    );
    const entry = plan.nodes.get(child.id);
    expect(plan.version).toBe("composition:1");
    expect(plan.nodes.get(frame.id)?.isolation).toBe("pass-through");
    expect(plan.nodes.get(frame.id)?.clipsContent).toBe(true);
    expect(entry?.clipDepth).toBe(1);
    expect(plan.nodes.get(frame.id)?.rotation).toBe(15);
    expect(entry?.inheritedOpacity).toBeCloseTo(0.2);
  });

  test("serializes plans deterministically and carries image asset bindings", () => {
    const image = node({
      id: "image",
      type: "IMAGE",
      fills: [
        {
          type: "IMAGE",
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          imageHash: "asset:hero",
        },
      ],
    });
    const plan = createCompositionPlan(graphOf([image], image.id), image.id);
    expect(plan.nodes.get(image.id)?.assetIds).toEqual(["asset:hero"]);
    expect(serializeCompositionPlan(plan)).toBe(serializeCompositionPlan(plan));
  });

  test("plans raster bases inside composition-full-v1 groups with clip, mask, rotation, and adjustments", () => {
    const group = node({
      id: "group",
      type: "GROUP",
      childIds: ["mask", "raster"],
      clipsContent: true,
      rotation: 18,
      blendMode: "PASS_THROUGH",
    });
    const mask = node({
      id: "mask",
      type: "VECTOR",
      parentId: group.id,
      isMask: true,
      maskType: "VECTOR",
      maskIsOutline: true,
    });
    const raster = node({
      id: "raster",
      type: "IMAGE",
      parentId: group.id,
      rotation: -7,
      fills: [
        {
          type: "IMAGE",
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          imageHash: "asset:raster-base",
        },
      ],
    });
    const plan = createCompositionPlan(
      graphOf([{ ...group }, mask, raster], group.id),
      group.id,
      { adjustmentHooks: ["exposure", "temperature"] },
    );

    expect(plan.nodes.get(group.id)).toMatchObject({
      clipsContent: true,
      clipDepth: 1,
      rotation: 18,
      isolation: "pass-through",
      adjustmentHooks: ["exposure", "temperature"],
    });
    expect(plan.nodes.get(mask.id)).toMatchObject({
      maskType: "VECTOR",
      maskIsOutline: true,
      maskDepth: 1,
    });
    expect(plan.nodes.get(raster.id)).toMatchObject({
      assetIds: ["asset:raster-base"],
      clipDepth: 1,
      rotation: -7,
      adjustmentHooks: ["exposure", "temperature"],
    });
  });

  test("hidden ancestors hide descendants without changing node semantics", () => {
    const frame = node({ id: "frame", type: "FRAME", visible: false, childIds: ["child"] });
    const child = node({ id: "child", type: "RECTANGLE", parentId: frame.id });
    const plan = createCompositionPlan(graphOf([frame, child], frame.id), frame.id);
    expect(plan.nodes.get(frame.id)?.visible).toBe(false);
    expect(plan.nodes.get(child.id)?.visible).toBe(false);
    expect(plan.nodes.get(child.id)?.opacity).toBe(1);
  });

  test("reports typed unsupported classes instead of silently dropping them", () => {
    const unsupported = node({ id: "unsupported", type: "WIDGET" as never });
    expect(() => createCompositionPlan(graphOf([unsupported], unsupported.id))).toThrow(
      CompositionUnsupportedClassError,
    );
  });

  test("preserves independent mask semantics and pass-through blend modes", () => {
    const mask = node({
      id: "mask",
      type: "VECTOR",
      isMask: true,
      maskType: "VECTOR",
      maskIsOutline: true,
      blendMode: "PASS_THROUGH",
    });
    const plan = createCompositionPlan(graphOf([mask], mask.id), mask.id);
    const entry = plan.nodes.get(mask.id);
    expect(entry?.maskType).toBe("VECTOR");
    expect(entry?.maskIsOutline).toBe(true);
    expect(entry?.isolation).toBe("isolated");
  });

  test("propagates adjustment hooks to every planned node", () => {
    const frame = node({ id: "frame", type: "FRAME", childIds: ["child"] });
    const child = node({ id: "child", type: "RECTANGLE", parentId: frame.id });
    const plan = createCompositionPlan(
      graphOf([frame, child], frame.id),
      undefined,
      { adjustmentHooks: ["tone-map", "grain"] },
    );

    expect(plan.nodes.get(frame.id)?.adjustmentHooks).toEqual(["tone-map", "grain"]);
    expect(plan.nodes.get(child.id)?.adjustmentHooks).toEqual(["tone-map", "grain"]);
    expect(serializeCompositionPlan(plan)).toContain('"adjustmentHooks":["tone-map","grain"]');
  });

  test("fails loudly when a planned child is missing", () => {
    const frame = node({ id: "frame", type: "FRAME", childIds: ["missing"] });

    expect(() => createCompositionPlan(graphOf([frame], frame.id), frame.id)).toThrow(
      "missing composition node: missing",
    );
  });

  test("fails loudly on cyclic composition parent links", () => {
    const first = node({ id: "first", type: "GROUP", childIds: ["second"] });
    const second = node({ id: "second", type: "GROUP", childIds: ["first"] });

    expect(() => createCompositionPlan(graphOf([first, second], first.id))).toThrow(
      "cyclic composition parent link: first",
    );
  });
});

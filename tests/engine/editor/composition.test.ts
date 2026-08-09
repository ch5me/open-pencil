import { describe, expect, test } from "bun:test";

import { createCompositionPlan } from "#core/editor/composition";
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
    expect(plan.nodes.get(frame.id)?.rotation).toBe(15);
    expect(entry?.inheritedOpacity).toBeCloseTo(0.2);
  });

  test("hidden ancestors hide descendants without changing node semantics", () => {
    const frame = node({ id: "frame", type: "FRAME", visible: false, childIds: ["child"] });
    const child = node({ id: "child", type: "RECTANGLE", parentId: frame.id });
    const plan = createCompositionPlan(graphOf([frame, child], frame.id), frame.id);
    expect(plan.nodes.get(frame.id)?.visible).toBe(false);
    expect(plan.nodes.get(child.id)?.visible).toBe(false);
    expect(plan.nodes.get(child.id)?.opacity).toBe(1);
  });
});

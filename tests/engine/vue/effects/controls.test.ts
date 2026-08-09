import { describe, expect, test } from "bun:test";
import { ref } from "vue";

import { SceneGraph, type Effect, type SceneNode } from "@open-pencil/core/scene-graph";

import {
  createDefaultEffect,
  createEffectControlActions,
  isShadow,
} from "#vue/controls/effects/helpers";

function node(effectValue: Effect): SceneNode {
  const graph = new SceneGraph();
  return graph.createNode("RECTANGLE", graph.getPages()[0].id, {
    name: "Rectangle",
    effects: [effectValue],
  });
}

function makeEffect(overrides: Partial<Effect> = {}): Effect {
  return {
    ...createDefaultEffect(),
    ...overrides,
  };
}

describe("effects controls", () => {
  test("creates a visible drop shadow with stable defaults", () => {
    expect(createDefaultEffect()).toEqual({
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 4,
      spread: 0,
      visible: true,
    });
  });

  test("classifies shadow and blur effect types", () => {
    expect(isShadow("DROP_SHADOW")).toBe(true);
    expect(isShadow("INNER_SHADOW")).toBe(true);
    expect(isShadow("LAYER_BLUR")).toBe(false);
  });

  test("switching from shadow to blur clears shadow-only controls", () => {
    const actions = createEffectControlActions(ref<number | null>(0));
    const current = node(makeEffect({ offset: { x: 8, y: -2 }, spread: 6 }));
    const patches: Array<{ index: number; changes: Partial<Effect> }> = [];

    actions.updateType(
      (index, changes) => patches.push({ index, changes }),
      current,
      0,
      "LAYER_BLUR",
    );

    expect(patches).toEqual([
      { index: 0, changes: { type: "LAYER_BLUR", offset: { x: 0, y: 0 }, spread: 0 } },
    ]);
  });

  test("switching from blur to shadow restores usable shadow defaults", () => {
    const actions = createEffectControlActions(ref<number | null>(0));
    const current = node(makeEffect({ type: "LAYER_BLUR", offset: { x: 12, y: 9 }, spread: 3 }));
    const patches: Array<{ index: number; changes: Partial<Effect> }> = [];

    actions.updateType(
      (index, changes) => patches.push({ index, changes }),
      current,
      0,
      "DROP_SHADOW",
    );

    expect(patches).toEqual([
      { index: 0, changes: { type: "DROP_SHADOW", offset: { x: 0, y: 4 }, spread: 0 } },
    ]);
  });

  test("updates color and keeps expanded row index coherent after removal", () => {
    const expandedIndex = ref<number | null>(2);
    const actions = createEffectControlActions(expandedIndex);
    const patches: Array<{ index: number; changes: Partial<Effect> }> = [];
    const color = { r: 0.2, g: 0.4, b: 0.8, a: 0.5 };

    actions.updateColor((index, changes) => patches.push({ index, changes }), 1, color);
    actions.handleRemove(() => undefined, 1);

    expect(patches).toEqual([{ index: 1, changes: { color } }]);
    expect(expandedIndex.value).toBe(1);

    actions.toggleExpand(1);
    expect(expandedIndex.value).toBe(null);
  });
});

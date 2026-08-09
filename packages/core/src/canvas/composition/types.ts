import type { AssetId } from "#core/editor/assets";
import type { BlendMode, MaskType, SceneGraph } from "#core/scene-graph";

export const COMPOSITION_PLAN_VERSION = "composition:1";

export type CompositionIsolation = "isolated" | "pass-through";

export interface CompositionNode {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly visible: boolean;
  readonly opacity: number;
  readonly inheritedOpacity: number;
  readonly blendMode: BlendMode;
  readonly isolation: CompositionIsolation;
  readonly clipsContent: boolean;
  readonly rotation: number;
  readonly maskType: MaskType | null;
  readonly assetIds: readonly AssetId[];
  readonly adjustmentHooks: readonly string[];
}

export interface CompositionPlan {
  readonly version: typeof COMPOSITION_PLAN_VERSION;
  readonly rootId: string;
  readonly nodes: ReadonlyMap<string, CompositionNode>;
}

export interface CompositionOptions {
  readonly adjustmentHooks?: readonly string[];
}

export function isCompositionContainer(type: string): boolean {
  return (
    type === "FRAME" ||
    type === "GROUP" ||
    type === "COMPONENT" ||
    type === "INSTANCE" ||
    type === "SECTION" ||
    type === "COMPONENT_SET"
  );
}

export function createCompositionPlan(
  graph: SceneGraph,
  rootId = graph.rootId,
  options: CompositionOptions = {},
): CompositionPlan {
  const nodes = new Map<string, CompositionNode>();
  const visit = (nodeId: string, parentOpacity: number, parentVisible: boolean): void => {
    const node = graph.getNode(nodeId);
    if (!node) throw new Error(`missing composition node: ${nodeId}`);
    const visible = parentVisible && node.visible;
    const inheritedOpacity = parentOpacity * node.opacity;
    const isolation =
      node.blendMode === "PASS_THROUGH" && isCompositionContainer(node.type)
        ? "pass-through"
        : "isolated";
    nodes.set(nodeId, {
      nodeId,
      parentId: node.parentId,
      childIds: [...node.childIds],
      visible,
      opacity: node.opacity,
      inheritedOpacity,
      blendMode: node.blendMode,
      isolation,
      clipsContent: node.clipsContent,
      rotation: node.rotation,
      maskType: node.isMask ? node.maskType : null,
      assetIds: (node.fills ?? [])
        .filter((fill) => fill.type === "IMAGE" && fill.imageHash?.startsWith("asset:"))
        .map((fill) => fill.imageHash as AssetId),
      adjustmentHooks: [...(options.adjustmentHooks ?? [])],
    });
    for (const childId of node.childIds) visit(childId, inheritedOpacity, visible);
  };
  visit(rootId, 1, true);
  return { version: COMPOSITION_PLAN_VERSION, rootId, nodes };
}

export function serializeCompositionPlan(plan: CompositionPlan): string {
  const nodes = [...plan.nodes.values()]
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    .map((node) => ({
      nodeId: node.nodeId,
      parentId: node.parentId,
      childIds: [...node.childIds],
      visible: node.visible,
      opacity: node.opacity,
      inheritedOpacity: node.inheritedOpacity,
      blendMode: node.blendMode,
      isolation: node.isolation,
      clipsContent: node.clipsContent,
      rotation: node.rotation,
      maskType: node.maskType,
      assetIds: [...node.assetIds].sort(),
      adjustmentHooks: [...node.adjustmentHooks],
    }));
  return JSON.stringify({ version: plan.version, rootId: plan.rootId, nodes });
}

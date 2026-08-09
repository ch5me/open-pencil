import type { AssetId } from "#core/editor/assets";
import type { BlendMode, MaskType, SceneGraph } from "#core/scene-graph";

export const COMPOSITION_PLAN_VERSION = "composition:1";

export type CompositionIsolation = "isolated" | "pass-through";

export class CompositionUnsupportedClassError extends Error {
  readonly code = "unsupported-composition-class";
}

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
  readonly clipDepth: number;
  readonly rotation: number;
  readonly bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly maskType: MaskType | null;
  readonly maskIsOutline: boolean;
  readonly maskDepth: number;
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

function assertSupportedType(type: string): void {
  if (
    !new Set([
      "CANVAS",
      "FRAME",
      "RECTANGLE",
      "ROUNDED_RECTANGLE",
      "ELLIPSE",
      "TEXT",
      "LINE",
      "STAR",
      "POLYGON",
      "VECTOR",
      "BOOLEAN_OPERATION",
      "GROUP",
      "SECTION",
      "COMPONENT",
      "COMPONENT_SET",
      "INSTANCE",
      "CONNECTOR",
      "SHAPE_WITH_TEXT",
      "IMAGE",
    ]).has(type)
  ) {
    throw new CompositionUnsupportedClassError(`unsupported composition class: ${type}`);
  }
}

export function createCompositionPlan(
  graph: SceneGraph,
  rootId = graph.rootId,
  options: CompositionOptions = {},
): CompositionPlan {
  const nodes = new Map<string, CompositionNode>();
  const visiting = new Set<string>();
  const visit = (
    nodeId: string,
    parentOpacity: number,
    parentVisible: boolean,
    parentClipDepth: number,
    parentMaskDepth: number,
  ): void => {
    if (visiting.has(nodeId)) {
      throw new Error(`cyclic composition parent link: ${nodeId}`);
    }
    const node = graph.getNode(nodeId);
    if (!node) throw new Error(`missing composition node: ${nodeId}`);
    assertSupportedType(node.type);
    visiting.add(nodeId);
    const visible = parentVisible && node.visible;
    const inheritedOpacity = parentOpacity * node.opacity;
    const clipDepth = parentClipDepth + (node.clipsContent ? 1 : 0);
    const maskDepth = parentMaskDepth + (node.isMask ? 1 : 0);
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
      clipDepth,
      rotation: node.rotation,
      bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
      maskType: node.isMask ? node.maskType : null,
      maskIsOutline: node.isMask ? node.maskIsOutline : false,
      maskDepth,
      assetIds: (node.fills ?? [])
        .filter((fill) => fill.type === "IMAGE" && fill.imageHash?.startsWith("asset:"))
        .map((fill) => fill.imageHash as AssetId),
      adjustmentHooks: [...(options.adjustmentHooks ?? [])],
    });
    for (const childId of node.childIds) {
      visit(childId, inheritedOpacity, visible, clipDepth, maskDepth);
    }
    visiting.delete(nodeId);
  };
  visit(rootId, 1, true, 0, 0);
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
      clipDepth: node.clipDepth,
      rotation: node.rotation,
      bounds: node.bounds,
      maskType: node.maskType,
      maskIsOutline: node.maskIsOutline,
      maskDepth: node.maskDepth,
      assetIds: [...node.assetIds].sort(),
      adjustmentHooks: [...node.adjustmentHooks],
    }));
  return JSON.stringify({ version: plan.version, rootId: plan.rootId, nodes });
}

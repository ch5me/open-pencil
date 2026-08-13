import { FigmaAPI } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'
export function createAPI(): FigmaAPI {
  return new FigmaAPI(new SceneGraph())
}

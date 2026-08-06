# Files

- [Figma API Compatibility Layer](figma-api.md) - Core exposes a Figma Plugin API-compatible surface backed by SceneGraph nodes and hidden Symbol state, allowing CLI eval, AI tools, and integrations to share one execution target.
- [Core IO, Tools, RPC, and Lint](io-and-tools.md) - Core registers format adapters, exposes framework-agnostic ToolDef operations, provides CLI RPC commands, and owns design lint rules; adapters translate these contracts for CLI, AI, MCP, and the app.
- [Core Layout, Geometry, and Vector Domains](layout-vector.md) - Yoga-backed layout computes flex and grid geometry; core geometry, snapping, and vector-network modules provide the coordinate and path primitives consumed by the editor and renderers.
- [Core Rendering, Text, and Fonts](rendering-text.md) - Core renders SceneGraph nodes through CanvasKit/Skia, SVG, PDF, and derived exports; text and font subsystems provide measurement, editing, style runs, and direction without making CanvasKit a global dependency.
- [Core SceneGraph and Editor State](scene-graph-editor.md) - The SceneGraph is the canonical mutable design model; the framework-agnostic editor assembles selection, viewport, pages, shapes, structure, components, clipboard, undo, text, and node actions around an EditorContext.

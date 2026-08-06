# Files

- [OpenPencil CLI](cli.md) - @open-pencil/cli publishes the openpencil binary for headless document inspection, conversion, import/export, linting, analysis, XPath queries, Figma API eval, and RPC control of a running app.
- [Core Package Architecture](core.md) - @open-pencil/core owns the canonical SceneGraph, editor actions, rendering, layout, document IO, Figma API compatibility, tools, and lint surfaces used by every higher-level adapter.
- [Documentation Site](docs.md) - @open-pencil/docs is the private VitePress site for user guides, CLI/MCP references, DOM/CSS mapping, and the Vue SDK; its config also generates LLM-oriented documentation output.
- [DOM CSS and Tailwind Package](dom-css.md) - @open-pencil/dom-css projects HTML, CSS, JSX, and Tailwind into DesignDOM and SceneGraph representations and serializes designs back to HTML. Browser and headless runtimes are separate fidelity boundaries.
- [Kiwi and Fig Package Boundary](kiwi-and-fig.md) - @open-pencil/kiwi owns low-level Kiwi schema, codec, GUID, compression, and .fig container protocol; @open-pencil/fig currently exposes container APIs only, while semantic SceneGraph .fig read/write remains in core.
- [MCP Server Package](mcp.md) - @open-pencil/mcp exposes core design tools through stdio and HTTP MCP transports, with a localhost WebSocket bridge to the running app and root-scoped file operations.
- [Headless Vue SDK](vue.md) - @open-pencil/vue is the curated Vue-facing SDK over core editor state: context, canvas/input, selection, commands, property controls, variables, and headless primitives for custom editor shells.

# Directories

- [core](core/)

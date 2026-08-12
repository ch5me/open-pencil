---
title: AI Chat
description: Built-in AI assistant with 90+ tools for creating and modifying designs.
---

# AI Chat

Press <kbd>⌘</kbd><kbd>J</kbd> (<kbd>Ctrl</kbd> + <kbd>J</kbd>) to open the AI assistant. Describe what you want — it creates shapes, sets styles, manages layout, works with components, and analyzes your design.

## Setup

1. Open the AI chat panel (<kbd>⌘</kbd><kbd>J</kbd>)
2. Click the settings icon
3. Add a model and configure its provider, model ID, credentials, and capabilities
4. Save the model and assign it to **Design agent**

You can configure multiple reusable models and separately assign models for design work, reviews, fast tasks, and image input. Models using the same provider connection reuse its stored credential.

### Supported Providers

| Provider                 | Models                                          | Setup                                                                                                       |
| ------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **OpenRouter**           | Claude, GPT, Gemini, DeepSeek, Qwen, and others | API key from [openrouter.ai](https://openrouter.ai)                                                         |
| **Anthropic**            | Claude Sonnet 4.6, Claude Opus 4.6              | API key from [console.anthropic.com](https://console.anthropic.com)                                         |
| **OpenAI**               | GPT-5.3 Codex, GPT-4.1, o3, o4-mini             | API key from [platform.openai.com](https://platform.openai.com)                                             |
| **Google AI**            | Gemini 3.1 Pro, Gemini 3 Flash                  | API key from [aistudio.google.dev](https://aistudio.google.dev)                                             |
| **Z.ai**                 | GLM-5.1, GLM-5, GLM-4.7, GLM-4.5 family         | API key from [docs.z.ai](https://docs.z.ai/devpack/quick-start)                                             |
| **MiniMax**              | MiniMax M3, M2.7, M2.7-highspeed, M2.5, M2.1    | API key from [platform.minimax.io](https://platform.minimax.io/user-center/basic-information/interface-key) |
| **OpenAI-compatible**    | Any endpoint with OpenAI API format             | Custom base URL + key. Supports Completions and Responses API toggle.                                       |
| **Anthropic-compatible** | Any endpoint with Anthropic API format          | Custom base URL + key                                                                                       |

No backend, no subscription — your key talks directly to the provider. Browser requests are subject to each provider's CORS policy, and model deployments vary in how reliably they stream tool calls. See [BYOK provider and model compatibility](./byok-provider-compatibility) for measured results and reproduction steps.

### Hosted deployments

A hosted OpenPencil deployment can provide an authenticated agent service
instead of asking users for model credentials. OpenPencil sends product-level
chat messages and receives streamed text and design-action requests. The service
chooses how the agent runs.

ELF sign-in authenticates the hosted OpenPencil session; it is separate from the
generic agent service. When the deployment enables hosted agent chat, the app
uses that service without requiring a provider or model profile. This setting is
independent of hosted document storage and collaboration.

The editor does not select or manage the service's model provider, billing,
runtimes, workers, containers, images, registries, or deployment infrastructure.
Design actions still execute inside OpenPencil through a remote-enabled subset
of the validated tool registry used by local chat and MCP. The hosted flow
supports streamed replies, correlated approval and tool-result continuation,
run cancellation, and reconnect after a transient disconnect or browser reload.
Reload recovery keeps only bounded, expiring, document-scoped run identity and
one pending provider-neutral continuation in session storage.

Hosted chat fails explicitly if its service is unavailable or a run cannot
reconnect. Hosted mode never sends the prompt to a configured BYOK provider or
local ACP agent as a fallback. Local and desktop installations can continue to
select BYOK or ACP directly when hosted agent chat is not enabled.

## What It Can Do

The assistant has 90+ tools across these categories:

- **Create** — frames, shapes, text, components, pages. Renders JSX for complex layouts.
- **Style** — fills, strokes, effects, opacity, corner radius, blend modes.
- **Layout** — auto-layout, grid, alignment, spacing, sizing.
- **Components** — create components, instances, component sets. Manage overrides.
- **Variables** — create/edit variables, collections, modes. Bind to fills.
- **Query** — find nodes, XPath selectors, read properties, list pages, fonts, selection.
- **Inspect** — `get_jsx` for JSX roundtrip view, `diff_jsx` for structural diffs, `describe` for semantic role and design issue detection.
- **Analyze** — color palette, typography audit, spacing consistency, cluster detection.
- **Export** — PNG, SVG, JSX with Tailwind classes. Vision-based verification via `export_image`.
- **Vector** — boolean operations, path manipulation.

## Visual Verification

The assistant can verify its work visually. After creating or modifying designs, it uses `export_image` to capture a screenshot and checks the result against the original request. This catches layout issues, missing elements, and color mismatches that text-only responses would miss.

## Example Prompts

- "Create a card with a title, description, and a blue button"
- "Make all buttons on this page use the same border radius"
- "What fonts are used in this file?"
- "Change the background of the selected frame to a gradient from blue to purple"
- "Export the selected frame as SVG"
- "Find all text nodes with font size less than 12"
- "Describe the selected component — what role does it look like?"
- "Show me the JSX for this frame"

## Tips

- Select nodes before asking — the assistant knows what's selected.
- Be specific about colors, sizes, and positions for precise results.
- The assistant can modify multiple nodes in one message.
- Use "undo" in the editor if you don't like the result — AI mutations support full undo.
- All layout is recomputed automatically after each tool execution.

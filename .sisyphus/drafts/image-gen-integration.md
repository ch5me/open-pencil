# Draft: OpenPencil Image Generation Integration

## Requirements (confirmed)
- Add image generation capability to OpenPencil
- Integrate with existing Scenario.com APIs and code
- Enable AI chat to generate images, icons, and other assets
- Consider creating a shared CH5 package for reusable image gen code

## Technical Decisions
- OpenPencil already has `stock_photo` tool with Pexels/Unsplash providers
- `set_image_fill` tool exists for applying base64 images as fills
- `FigmaAPI.createImage(bytes)` is the integration point — any gen API that returns bytes plugs in
- scenario-image-gen has a battle-tested ScenarioClient (759 lines) — fully reusable
- CH5 packages monorepo at ~/ch5-packages/ with 38 packages, @ch5me scope, pnpm + changesets
- OpenPencil uses bun workspaces, @open-pencil scope, npm public registry
- No image generation code exists in open-pencil workspace — clean integration point

## Research Findings
- scenario-image-gen: ScenarioClient class + types.ts are fully reusable (no CLI deps)
- OpenPencil tool pattern: defineTool() → registry.ts → instant in AI chat/MCP/CLI
- CH5 packages: canonical structure is src/index.ts + package.json + tsconfig + tsconfig.build.json
- No existing image-gen shared package in CH5
- icon-gen/api has a simpler ScenarioClient but uses different API endpoint (api.scenario.com vs api.cloud.scenario.com)
- fitbot has img2img trial scripts and OpenRouter image generation scripts
- OpenPencil uses native fetch, not axios — ScenarioClient needs refactoring

## Scope Boundaries
- INCLUDE: generate_image tool in OpenPencil, Scenario integration, AI chat usage
- INCLUDE: Consider shared package extraction if reusable code warrants it
- EXCLUDE: img2img, background removal, layered images (future work)
- EXCLUDE: UI changes beyond provider settings API key field

## Architecture Decision
Recommended: Create @ch5me/scenario-client as shared package containing:
- ScenarioClient class (from scenario-image-gen, refactored to use fetch)
- All types (from scenario-image-gen)
- Model detection logic
- Polling utilities

Then both scenario-image-gen and open-pencil consume it.

## Integration Plan
1. Extract ScenarioClient to @ch5me/scenario-client (refactor axios → fetch)
2. Define generate_image ToolDef types and provider interface
3. Add Scenario API key/secret to ProviderSettings
4. Implement ScenarioImageGenProvider
5. Update scenario-image-gen to use shared package
6. Register generate_image in CORE_TOOLS
7. Wire to AI chat
8. Add unit tests
9. Add E2E test

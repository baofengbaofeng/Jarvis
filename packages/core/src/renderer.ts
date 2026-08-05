// Renderer-safe entry for `@jarvis/core`.
//
// The desktop renderer bundles core as source (`main: ./src/index.ts`), and the
// full barrel re-exports Node-dependent modules (LspClient, runTests, Sandbox,
// mcp transport, tools, plugins) whose `node:*` imports cannot be bundled for
// the browser. Renderer components must import from this entry
// (`@jarvis/core/renderer`) instead of the full barrel. Every module re-exported
// here is dependency-free (pure logic), so it is safe to bundle.
//
// Keep this list in sync with the pure modules under `src/coding/` and
// `src/office/`; anything that imports `node:*` (transitively or not) does NOT
// belong here. officeChat/selection are pure prompt/stream helpers (no node:*).
export * from './office/content';
export * from './office/officeChat';
export * from './office/selection';
export * from './office/writing';
export * from './office/pdf';
export * from './office/webpage';
export * from './office/speech';
export * from './office/files';
export * from './office/dropzone';
export * from './office/templates';
export * from './office/search';
export * from './office/searchProvider';
export * from './coding/diff';
export * from './coding/mention';
export * from './coding/filetree';
export * from './coding/plan';
export * from './coding/structured';
export * from './coding/session';
export * from './coding/parallel';
export * from './coding/snapshot';
export * from './coding/fixloop';
export * from './coding/index/chunker';
export * from './coding/index/IndexStore';

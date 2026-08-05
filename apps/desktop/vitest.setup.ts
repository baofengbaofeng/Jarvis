// Shared vitest setup for the @jarvis/desktop test suite.
//
// react-flow (CallGraphView, M6 Task 10 / L14) needs ResizeObserver at mount
// time. jsdom does not provide it, so install a no-op class. The guard keeps
// this harmless in the Node-env main-process specs, which never touch react-flow
// and simply leave the (unused) global undefined-free.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserverNoop {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

import { vi, expect, type Mock } from 'vitest';

export type JarvisInvoke = (channel: string, ...args: unknown[]) => unknown | Promise<unknown>;

export type MockJarvisOptions = {
  invoke?: JarvisInvoke;
  settingsGet?: (key: string) => unknown | Promise<unknown>;
  settingsSet?: (key: string, value: unknown) => unknown | Promise<unknown>;
  onDidReceive?: (channel: string, cb: (payload: unknown) => void) => () => void;
};

export type MockJarvis = {
  invoke: Mock<(channel: string, ...args: unknown[]) => Promise<unknown>>;
  settingsGet: Mock<(key: string) => Promise<unknown>>;
  settingsSet: Mock<(key: string, value: unknown) => Promise<void>>;
  onDidReceive: Mock<(channel: string, cb: (payload: unknown) => void) => () => void>;
};

/** Install a lightweight `window.jarvis` bridge for renderer unit tests. */
export function installMockJarvis(opts: MockJarvisOptions = {}): MockJarvis {
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (opts.invoke) return opts.invoke(channel, ...args);
    return undefined;
  });
  const settingsGet = vi.fn(async (key: string) => {
    if (opts.settingsGet) return opts.settingsGet(key);
    return undefined;
  });
  const settingsSet = vi.fn(async (key: string, value: unknown) => {
    if (opts.settingsSet) {
      await opts.settingsSet(key, value);
      return;
    }
  });
  const onDidReceive = vi.fn(
    opts.onDidReceive ?? ((_channel: string, _cb: (payload: unknown) => void) => () => {}),
  );

  const jarvis = { invoke, settingsGet, settingsSet, onDidReceive };
  (window as unknown as { jarvis: typeof jarvis }).jarvis = jarvis;
  return jarvis;
}

/** Assert at least one invoke call matched channel + optional arg predicate. */
export function expectInvoke(
  invoke: Mock<(channel: string, ...args: unknown[]) => Promise<unknown>>,
  channel: string,
  predicate?: (...args: unknown[]) => boolean,
): unknown[] {
  const match = invoke.mock.calls.find((call) => {
    if (call[0] !== channel) return false;
    if (!predicate) return true;
    return predicate(...call.slice(1));
  });
  expect(match, `expected invoke(${JSON.stringify(channel)}, …)`).toBeTruthy();
  return match!.slice(1);
}

interface Window {
  jarvis: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    settingsGet: (key: string) => Promise<unknown>;
    settingsSet: (key: string, value: unknown) => Promise<void>;
    onDidReceive: (channel: string, cb: (payload: unknown) => void) => () => void;
  };
}

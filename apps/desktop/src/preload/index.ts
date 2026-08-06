import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, assertAllowedInvoke, assertAllowedEvent } from '@jarvis/protocol';

contextBridge.exposeInMainWorld('jarvis', {
  invoke: (channel: string, ...args: unknown[]) => {
    assertAllowedInvoke(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  settingsGet: (key: string) => ipcRenderer.invoke(IpcChannel.settingsGet, key),
  settingsSet: (key: string, value: unknown) => ipcRenderer.invoke(IpcChannel.settingsSet, key, value),
  onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
    assertAllowedEvent(channel);
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});

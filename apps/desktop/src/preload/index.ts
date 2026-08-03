import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '@jarvis/protocol';

contextBridge.exposeInMainWorld('jarvis', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  settingsGet: (key: string) => ipcRenderer.invoke(IpcChannel.settingsGet, key),
  settingsSet: (key: string, value: unknown) => ipcRenderer.invoke(IpcChannel.settingsSet, key, value),
  onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});

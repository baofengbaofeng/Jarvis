import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '@jarvis/protocol';
import { gateEventChannel, gateInvokeChannel } from './ipc-gate';

contextBridge.exposeInMainWorld('jarvis', {
  invoke: (channel: string, ...args: unknown[]) => {
    gateInvokeChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  settingsGet: (key: string) => {
    gateInvokeChannel(IpcChannel.settingsGet);
    return ipcRenderer.invoke(IpcChannel.settingsGet, key);
  },
  settingsSet: (key: string, value: unknown) => {
    gateInvokeChannel(IpcChannel.settingsSet);
    return ipcRenderer.invoke(IpcChannel.settingsSet, key, value);
  },
  onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
    gateEventChannel(channel);
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});

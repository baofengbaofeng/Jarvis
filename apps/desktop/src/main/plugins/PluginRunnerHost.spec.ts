import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PluginRunnerHost, type UtilityChild } from './PluginRunnerHost';
import type { PluginDescriptor } from '@jarvis/core';
import { encodeRpcFrame, hashPluginSource } from '@jarvis/core';

const SOURCE = 'registerTool({name:"hang",description:"",parameters:{}}, async()=>({ok:true,output:"ok"}));';

const descriptor: PluginDescriptor = {
  manifest: { schemaVersion: 1, id: 'p1', name: 'P1', entry: 'index.js', permissions: [] },
  root: '/plugins/p1',
  entryPath: '/plugins/p1/index.js',
  sha256: hashPluginSource(SOURCE),
};

class FakeUtilityChild extends EventEmitter implements UtilityChild {
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('exit', 1));
  });
  postMessage = vi.fn((raw: string) => {
    const msg = JSON.parse(raw) as { type: string };
    if (msg.type === 'source') {
      queueMicrotask(() => {
        this.emit('message', encodeRpcFrame({
          type: 'register',
          tools: [{ name: 'hang', description: '', parameters: {} }],
        }));
        this.emit('message', encodeRpcFrame({ type: 'ready' }));
      });
    }
    // invoke: intentionally never replies (hang)
  });
}

describe('PluginRunnerHost', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('kills an invocation that exceeds the deadline and rejects all pending calls', async () => {
    const child = new FakeUtilityChild();
    const host = new PluginRunnerHost({
      fork: () => child,
      approval: async () => true,
      invokeTimeoutMs: 20,
      readSource: async () => SOURCE,
    });
    await host.load(descriptor, descriptor.sha256);
    const pending = host.invoke('p1', 'hang', {}, { cwd: '/ws', env: {} });
    await expect(pending).rejects.toThrow('PLUGIN_TIMEOUT');
    expect(child.kill).toHaveBeenCalled();
    expect(host.pendingCount()).toBe(0);
  });

  it('refuses a changed hash before process start', async () => {
    const fork = vi.fn();
    const host = new PluginRunnerHost({
      fork,
      approval: async (_d, hash) => hash === 'approved',
      readSource: async () => SOURCE,
    });
    await expect(host.load(descriptor, 'old-hash')).rejects.toThrow('PLUGIN_APPROVAL_REQUIRED');
    expect(fork).not.toHaveBeenCalled();
  });

  it('rejects oversized child messages before JSON parse and clears pending', async () => {
    const child = new FakeUtilityChild();
    const host = new PluginRunnerHost({
      fork: () => child,
      approval: async () => true,
      invokeTimeoutMs: 5_000,
      readSource: async () => SOURCE,
    });
    await host.load(descriptor, descriptor.sha256);
    const pending = host.invoke('p1', 'hang', {}, { cwd: '/ws', env: {} });
    const huge = 'x'.repeat(256 * 1024 + 1);
    child.emit('message', huge);
    await expect(pending).rejects.toThrow('PLUGIN_FRAME_TOO_LARGE');
    expect(host.pendingCount()).toBe(0);
  });

  it('rejects pending calls when the child crashes', async () => {
    const child = new FakeUtilityChild();
    const host = new PluginRunnerHost({
      fork: () => child,
      approval: async () => true,
      invokeTimeoutMs: 5_000,
      readSource: async () => SOURCE,
    });
    await host.load(descriptor, descriptor.sha256);
    const pending = host.invoke('p1', 'hang', {}, { cwd: '/ws', env: {} });
    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('PLUGIN_CRASHED');
    expect(host.pendingCount()).toBe(0);
  });

  it('probe stays responsive after a timed-out plugin kill', async () => {
    const child = new FakeUtilityChild();
    const host = new PluginRunnerHost({
      fork: () => child,
      approval: async () => true,
      invokeTimeoutMs: 20,
      readSource: async () => SOURCE,
    });
    await host.load(descriptor, descriptor.sha256);
    await expect(host.invoke('p1', 'hang', {}, { cwd: '/ws', env: {} })).rejects.toThrow('PLUGIN_TIMEOUT');
    expect(host.probe()).toEqual({ ok: true });
  });
});

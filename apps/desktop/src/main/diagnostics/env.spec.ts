import { describe, it, expect } from 'vitest';
import { collectEnvInfo } from './env';

describe('collectEnvInfo', () => {
  it('reports versions from exec output', async () => {
    const info = await collectEnvInfo({
      execImpl: async (cmd) => {
        if (cmd.includes('node')) return { stdout: 'v20.11.0\n' };
        if (cmd.includes('go')) return { stdout: 'go version go1.22.4 darwin/arm64\n' };
        return { stdout: '' };
      },
      daemonRunning: () => Promise.resolve(true),
      whichImpl: async () => '/usr/local/bin/jarvis-agent'
    });
    expect(info.nodeVersion).toContain('20.11');
    expect(info.goVersion).toContain('1.22');
    expect(info.daemonRunning).toBe(true);
    expect(info.agentCliOnPath).toBe(true);
  });
});

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface McpServerRow { id: string; name: string; transport: string; config: { command?: string; args?: string[]; agentIds?: string[] } }
interface AgentOption { id: string; name: string }

export function McpSettingsPage() {
  const { t } = useTranslation('common');
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const refresh = async () => {
    const [srv, agts] = await Promise.all([
      window.jarvis.invoke('mcp.list') as Promise<McpServerRow[]>,
      window.jarvis.invoke('agent.list') as Promise<AgentOption[]>
    ]);
    setServers(Array.isArray(srv) ? srv : []);
    setAgents(Array.isArray(agts) ? agts : []);
  };
  useEffect(() => { void refresh(); }, []);

  const add = async () => {
    await window.jarvis.invoke('mcp.create', {
      name, transport: 'stdio', command, args: args.split(/\s+/).filter(Boolean), agentIds
    });
    setName(''); setCommand(''); setArgs(''); setAgentIds([]);
    await refresh();
  };

  const toggleAgent = (id: string) => setAgentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const test = async (s: McpServerRow) => {
    const r = await window.jarvis.invoke('mcp.test', { id: s.id }) as { ok: boolean; tools: string[]; error?: string };
    setTestResult(prev => ({ ...prev, [s.id]: r.ok ? t('settings.mcp.testOk', { count: r.tools.length }) : `${t('settings.mcp.testFail')}: ${r.error ?? ''}` }));
  };

  return (
    <div data-testid="mcp-settings">
      <h2>{t('settings.mcp.title')}</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <input data-testid="mcp-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.mcp.name')} />
        <input data-testid="mcp-command" value={command} onChange={e => setCommand(e.target.value)} placeholder={t('settings.mcp.command')} />
        <input data-testid="mcp-args" value={args} onChange={e => setArgs(e.target.value)} placeholder={t('settings.mcp.args')} />
      </div>
      <div data-testid="mcp-agents" style={{ marginBottom: 8 }}>
        {agents.map(a => (
          <label key={a.id} style={{ marginRight: 8 }}>
            <input type="checkbox" checked={agentIds.includes(a.id)} onChange={() => toggleAgent(a.id)} />
            {a.name}
          </label>
        ))}
      </div>
      <button data-testid="mcp-add" onClick={() => void add()}>+</button>
      <ul>
        {servers.map(s => (
          <li key={s.id} data-testid={`mcp-server-${s.id}`}>
            <span>{s.name} ({s.transport})</span>
            <button data-testid={`mcp-test-${s.id}`} onClick={() => void test(s)}>{t('settings.mcp.test')}</button>
            {testResult[s.id] && <span data-testid={`mcp-test-result-${s.id}`}> {testResult[s.id]}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel, Select } from '@jarvis/ui';

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
    <div data-testid="mcp-settings" className="page form-stack">
      <h2 className="page__title">{t('settings.mcp.title')}</h2>
      <Panel className="form-stack">
        <div className="settings-inline-row">
          <Input data-testid="mcp-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.mcp.name')} />
          <Input data-testid="mcp-command" value={command} onChange={e => setCommand(e.target.value)} placeholder={t('settings.mcp.command')} />
          <Input data-testid="mcp-args" value={args} onChange={e => setArgs(e.target.value)} placeholder={t('settings.mcp.args')} />
          <Button variant="primary" data-testid="mcp-add" onClick={() => void add()}>+</Button>
        </div>
        <div data-testid="mcp-agents" className="checkbox-group">
          {agents.map(a => (
            <label key={a.id} className="checkbox-label">
              <input type="checkbox" checked={agentIds.includes(a.id)} onChange={() => toggleAgent(a.id)} />
              {a.name}
            </label>
          ))}
        </div>
      </Panel>
      <ul className="settings-card-list">
        {servers.map(s => (
          <li key={s.id}>
            <Panel className="settings-card" data-testid={`mcp-server-${s.id}`}>
              <div className="settings-card__header">
                <span className="settings-card__title">{s.name} <span className="settings-card__meta">({s.transport})</span></span>
                <Button variant="ghost" size="sm" data-testid={`mcp-test-${s.id}`} onClick={() => void test(s)}>{t('settings.mcp.test')}</Button>
              </div>
              {testResult[s.id] && <div data-testid={`mcp-test-result-${s.id}`} className="settings-card__meta">{testResult[s.id]}</div>}
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}

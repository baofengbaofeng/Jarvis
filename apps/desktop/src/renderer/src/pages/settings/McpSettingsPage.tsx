import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function McpSettingsPage() {
  const { t } = useTranslation('common');
  const [servers, setServers] = useState<Array<{ id: string; name: string; transport: string }>>([]);
  const [name, setName] = useState(''); const [command, setCommand] = useState('');
  const refresh = async () => setServers((await window.jarvis.invoke('mcp.list')) as typeof servers);
  useEffect(() => { void refresh(); }, []);
  const add = async () => {
    await window.jarvis.invoke('mcp.create', { name, transport: 'stdio', command, args: [] });
    setName(''); setCommand(''); await refresh();
  };
  return (
    <div data-testid="mcp-settings">
      <h2>{t('menu.skills')} MCP</h2>
      <input data-testid="mcp-name" value={name} onChange={e => setName(e.target.value)} />
      <input data-testid="mcp-command" value={command} onChange={e => setCommand(e.target.value)} placeholder={t('settings.mcp.command')} />
      <button data-testid="mcp-add" onClick={() => void add()}>+</button>
      <ul>{servers.map(s => <li key={s.id}>{s.name} ({s.transport})</li>)}</ul>
    </div>
  );
}

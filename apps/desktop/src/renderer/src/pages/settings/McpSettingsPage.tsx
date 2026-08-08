import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Modal, ModalMessage, PageHeader } from '@jarvis/ui';
import { MCP_FIELD_MAX } from '@jarvis/protocol';
import { FieldInput } from '../../components/settings/FieldInput';
import { EnableToggle } from '../../components/EnableToggle';
import { IconTrash } from '../../components/shell/ShellIcons';

interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  enabled?: boolean;
  config: { command?: string; args?: string[]; agentIds?: string[] };
}
interface AgentOption { id: string; name: string }

type FieldKey = 'name' | 'command' | 'args' | 'form';

function mapMcpError(code: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (code) {
    case 'MCP_NAME_REQUIRED':
      return t('settings.mcp.errors.nameRequired');
    case 'MCP_NAME_TOO_LONG':
      return t('settings.mcp.errors.nameTooLong', { max: MCP_FIELD_MAX.name });
    case 'MCP_COMMAND_REQUIRED':
      return t('settings.mcp.errors.commandRequired');
    case 'MCP_COMMAND_TOO_LONG':
      return t('settings.mcp.errors.commandTooLong', { max: MCP_FIELD_MAX.command });
    case 'MCP_COMMAND_UNSAFE':
      return t('settings.mcp.errors.commandUnsafe');
    case 'MCP_COMMAND_NOT_ALLOWED':
      return t('settings.mcp.errors.commandNotAllowed');
    case 'MCP_ARGS_TOO_LONG':
      return t('settings.mcp.errors.argsTooLong', { max: MCP_FIELD_MAX.args });
    default:
      return code || t('settings.mcp.errors.unknown');
  }
}

function fieldForError(code: string): FieldKey {
  if (code.startsWith('MCP_NAME_')) return 'name';
  if (code.startsWith('MCP_COMMAND_') || code === 'MCP_COMMAND_REQUIRED') return 'command';
  if (code.startsWith('MCP_ARGS_')) return 'args';
  return 'form';
}

export function McpSettingsPage() {
  const { t } = useTranslation('common');
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<McpServerRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [srv, agts] = await Promise.all([
      window.jarvis.invoke('mcp.list') as Promise<McpServerRow[]>,
      window.jarvis.invoke('agent.list') as Promise<AgentOption[]>,
    ]);
    setServers(Array.isArray(srv) ? srv : []);
    setAgents(Array.isArray(agts) ? agts : []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const clearFieldError = (key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const add = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldErrors({ name: t('settings.mcp.errors.nameRequired') });
      return;
    }
    if (trimmedName.length > MCP_FIELD_MAX.name) {
      setFieldErrors({ name: t('settings.mcp.errors.nameTooLong', { max: MCP_FIELD_MAX.name }) });
      return;
    }
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      setFieldErrors({ command: t('settings.mcp.errors.commandRequired') });
      return;
    }
    if (trimmedCommand.length > MCP_FIELD_MAX.command) {
      setFieldErrors({ command: t('settings.mcp.errors.commandTooLong', { max: MCP_FIELD_MAX.command }) });
      return;
    }
    const argList = args.split(/\s+/).filter(Boolean);
    if (argList.join(' ').length > MCP_FIELD_MAX.args) {
      setFieldErrors({ args: t('settings.mcp.errors.argsTooLong', { max: MCP_FIELD_MAX.args }) });
      return;
    }
    setFieldErrors({});
    const res = (await window.jarvis.invoke('mcp.create', {
      name: trimmedName,
      transport: 'stdio',
      command: trimmedCommand,
      args: argList,
      agentIds,
    })) as { ok?: boolean; error?: string; server?: McpServerRow } | McpServerRow;
    if (res && typeof res === 'object' && 'ok' in res && res.ok === false) {
      const code = res.error ?? '';
      setFieldErrors({ [fieldForError(code)]: mapMcpError(code, t) });
      return;
    }
    setName('');
    setCommand('');
    setArgs('');
    setAgentIds([]);
    await refresh();
  };

  const toggleAgent = (id: string) =>
    setAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const test = async (s: McpServerRow) => {
    const r = (await window.jarvis.invoke('mcp.test', { id: s.id })) as {
      ok: boolean;
      tools: string[];
      error?: string;
    };
    setTestResult((prev) => ({
      ...prev,
      [s.id]: r.ok
        ? t('settings.mcp.testOk', { count: r.tools.length })
        : `${t('settings.mcp.testFail')}: ${r.error ?? ''}`,
    }));
  };

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: t('settings.mcp.colName'),
        render: (row: McpServerRow) => (
          <span data-testid={`mcp-server-${row.id}`} title={row.name}>{row.name}</span>
        ),
      },
      {
        key: 'transport',
        header: t('settings.mcp.colTransport'),
        render: (row: McpServerRow) => row.transport,
      },
      {
        key: 'enabled',
        header: t('settings.mcp.colEnabled'),
        render: (row: McpServerRow) => (
          <EnableToggle
            enabled={row.enabled !== false}
            testId={`mcp-enabled-${row.id}`}
            aria-label={row.enabled !== false ? t('settings.mcp.disable') : t('settings.mcp.enable')}
            onChange={(next) => {
              void window.jarvis.invoke('mcp.setEnabled', row.id, next).then(async (res) => {
                const result = res as { ok?: boolean } | undefined;
                if (result && result.ok === false) return;
                await refresh();
              });
            }}
          />
        ),
      },
      {
        key: 'actions',
        header: t('settings.mcp.colActions'),
        render: (row: McpServerRow) => (
          <div className="provider-models-table__action-btn">
            <Button
              variant="ghost"
              size="sm"
              data-testid={`mcp-test-${row.id}`}
              onClick={() => void test(row)}
            >
              {t('settings.mcp.test')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="provider-icon-btn provider-icon-btn--delete"
              data-testid={`mcp-delete-${row.id}`}
              aria-label={t('settings.mcp.remove')}
              onClick={() => {
                setDeleteError(null);
                setDeleting(row);
              }}
            >
              <IconTrash />
            </Button>
            {testResult[row.id] ? (
              <span data-testid={`mcp-test-result-${row.id}`} className="settings-card__meta">
                {testResult[row.id]}
              </span>
            ) : null}
          </div>
        ),
      },
    ],
    [refresh, t, testResult],
  );

  return (
    <div data-testid="mcp-settings" className="page form-stack settings-page">
      <PageHeader title={t('settings.mcp.title')} subtitle={t('settings.mcp.subtitle')} />
      <div className="provider-add-area" data-testid="mcp-add-area">
        <div className="form-stack">
          <div className="form-field">
            <label htmlFor="mcp-name">{t('settings.mcp.name')}</label>
            <p className="form-field__hint form-field__hint--2line" title={t('settings.mcp.nameHint')}>
              {t('settings.mcp.nameHint')}
            </p>
            <FieldInput
              id="mcp-name"
              data-testid="mcp-name"
              value={name}
              maxLength={MCP_FIELD_MAX.name}
              error={fieldErrors.name}
              errorTestId="mcp-name-error"
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError('name');
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="mcp-command">{t('settings.mcp.command')}</label>
            <p className="form-field__hint form-field__hint--2line" title={t('settings.mcp.commandHint')}>
              {t('settings.mcp.commandHint')}
            </p>
            <FieldInput
              id="mcp-command"
              data-testid="mcp-command"
              value={command}
              maxLength={MCP_FIELD_MAX.command}
              error={fieldErrors.command}
              errorTestId="mcp-command-error"
              onChange={(e) => {
                setCommand(e.target.value);
                clearFieldError('command');
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="mcp-args">{t('settings.mcp.args')}</label>
            <p className="form-field__hint form-field__hint--1line" title={t('settings.mcp.argsHint')}>
              {t('settings.mcp.argsHint')}
            </p>
            <FieldInput
              id="mcp-args"
              data-testid="mcp-args"
              value={args}
              maxLength={MCP_FIELD_MAX.args}
              error={fieldErrors.args}
              errorTestId="mcp-args-error"
              onChange={(e) => {
                setArgs(e.target.value);
                clearFieldError('args');
              }}
            />
          </div>
          <div data-testid="mcp-agents" className="checkbox-group">
            <span className="form-field__label">{t('settings.mcp.agents')}</span>
            {agents.map((a) => (
              <label key={a.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={agentIds.includes(a.id)}
                  onChange={() => toggleAgent(a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
          {fieldErrors.form ? (
            <p data-testid="mcp-form-error" role="alert" className="form-field__error">{fieldErrors.form}</p>
          ) : null}
          <Button variant="primary" data-testid="mcp-add" onClick={() => void add()}>
            {t('settings.mcp.add')}
          </Button>
        </div>
      </div>
      {servers.length > 0 ? (
        <div data-testid="mcp-list-section">
          <h2 className="settings-section-title">{t('settings.mcp.listTitle')}</h2>
          <DataTable columns={columns} rows={servers} rowKey={(row) => row.id} />
        </div>
      ) : null}

      <Modal
        open={deleting != null}
        title={t('settings.mcp.deleteTitle')}
        onClose={() => {
          if (deletingBusy) return;
          setDeleting(null);
          setDeleteError(null);
        }}
        testId="mcp-delete-modal"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid="mcp-delete-cancel"
              disabled={deletingBusy}
              onClick={() => {
                setDeleting(null);
                setDeleteError(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="mcp-delete-confirm"
              disabled={deletingBusy}
              onClick={() => {
                if (!deleting) return;
                setDeletingBusy(true);
                void window.jarvis
                  .invoke('mcp.delete', deleting.id)
                  .then(async (res) => {
                    const result = res as { ok?: boolean; error?: string } | undefined;
                    if (result && result.ok === false) {
                      setDeleteError(mapMcpError(result.error ?? '', t));
                      return;
                    }
                    setDeleting(null);
                    setDeleteError(null);
                    await refresh();
                  })
                  .finally(() => setDeletingBusy(false));
              }}
            >
              {t('settings.mcp.remove')}
            </Button>
          </>
        }
      >
        {deleting ? (
          <>
            <ModalMessage>
              {t('settings.mcp.deleteConfirm', { name: deleting.name })}
            </ModalMessage>
            {deleteError ? (
              <ModalMessage testId="mcp-delete-error" className="form-field__error">
                {deleteError}
              </ModalMessage>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

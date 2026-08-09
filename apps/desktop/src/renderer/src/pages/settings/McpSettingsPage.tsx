import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Modal, ModalMessage, PageHeader } from '@jarvis/ui';
import { MCP_FIELD_MAX } from '@jarvis/protocol';
import { MINIMAL_MCP_SAMPLE as SAMPLE } from '@jarvis/core/renderer';
import { FieldInput } from '../../components/settings/FieldInput';
import { EnableToggle } from '../../components/EnableToggle';
import { IconTrash } from '../../components/shell/ShellIcons';

interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  enabled?: boolean;
  config: {
    command?: string;
    args?: string[];
    cwd?: string;
    url?: string;
    description?: string;
    timeoutMs?: number;
    autoApprove?: string[];
  };
}
type Transport = 'stdio' | 'sse' | 'http';
type FieldKey = 'name' | 'command' | 'args' | 'url' | 'form';

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
    case 'MCP_URL_REQUIRED':
      return t('settings.mcp.errors.urlRequired');
    default:
      return code || t('settings.mcp.errors.unknown');
  }
}

function fieldForError(code: string): FieldKey {
  if (code.startsWith('MCP_NAME_')) return 'name';
  if (code.startsWith('MCP_COMMAND_') || code === 'MCP_COMMAND_REQUIRED') return 'command';
  if (code.startsWith('MCP_ARGS_')) return 'args';
  if (code.startsWith('MCP_URL_')) return 'url';
  return 'form';
}

export function McpSettingsPage() {
  const { t } = useTranslation('common');
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<Transport>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('30000');
  const [autoApprove, setAutoApprove] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<McpServerRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(true);
  const [maxConcurrent, setMaxConcurrent] = useState('3');
  const [importText, setImportText] = useState('');
  const [ioMsg, setIoMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [srv, auto, max] = await Promise.all([
      window.jarvis.invoke('mcp.list') as Promise<McpServerRow[]>,
      window.jarvis.settingsGet('mcp.auto_start'),
      window.jarvis.settingsGet('mcp.max_concurrent_tools'),
    ]);
    setServers(Array.isArray(srv) ? srv : []);
    if (typeof auto === 'boolean') setAutoStart(auto);
    if (typeof max === 'number') setMaxConcurrent(String(max));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setTransport('stdio');
    setCommand('');
    setArgs('');
    setCwd('');
    setUrl('');
    setDescription('');
    setTimeoutMs('30000');
    setAutoApprove('');
    setFieldErrors({});
  };

  const clearFieldError = (key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const loadRow = (row: McpServerRow) => {
    setEditingId(row.id);
    setName(row.name);
    setTransport((row.transport === 'sse' || row.transport === 'http' ? row.transport : 'stdio') as Transport);
    setCommand(row.config.command ?? '');
    setArgs((row.config.args ?? []).join(' '));
    setCwd(row.config.cwd ?? '');
    setUrl(row.config.url ?? '');
    setDescription(row.config.description ?? '');
    setTimeoutMs(String(row.config.timeoutMs ?? 30_000));
    setAutoApprove((row.config.autoApprove ?? []).join(', '));
    setFieldErrors({});
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldErrors({ name: t('settings.mcp.errors.nameRequired') });
      return;
    }
    const payload: Record<string, unknown> = {
      name: trimmedName,
      transport,
      description: description.trim() || undefined,
      timeoutMs: Number(timeoutMs) || 30_000,
      autoApprove: autoApprove.split(/[,\s]+/).filter(Boolean),
    };
    if (transport === 'stdio') {
      const trimmedCommand = command.trim();
      if (!trimmedCommand) {
        setFieldErrors({ command: t('settings.mcp.errors.commandRequired') });
        return;
      }
      payload.command = trimmedCommand;
      payload.args = args.split(/\s+/).filter(Boolean);
      payload.cwd = cwd.trim() || undefined;
    } else {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setFieldErrors({ url: t('settings.mcp.errors.urlRequired') });
        return;
      }
      payload.url = trimmedUrl;
    }
    setFieldErrors({});
    const res = editingId
      ? await window.jarvis.invoke('mcp.update', { id: editingId, ...payload }) as { ok?: boolean; error?: string }
      : await window.jarvis.invoke('mcp.create', payload) as { ok?: boolean; error?: string };
    if (res && res.ok === false) {
      const code = res.error ?? '';
      setFieldErrors({ [fieldForError(code)]: mapMcpError(code, t) });
      return;
    }
    resetForm();
    await refresh();
  };

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
            <Button variant="ghost" size="sm" data-testid={`mcp-edit-${row.id}`} onClick={() => loadRow(row)}>
              {t('settings.mcp.edit')}
            </Button>
            <Button variant="ghost" size="sm" data-testid={`mcp-test-${row.id}`} onClick={() => void test(row)}>
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

      <section className="form-stack" data-testid="mcp-global">
        <h2 className="settings-section-title">{t('settings.mcp.globalTitle')}</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            data-testid="mcp-auto-start"
            checked={autoStart}
            onChange={(e) => {
              const v = e.target.checked;
              setAutoStart(v);
              void window.jarvis.settingsSet('mcp.auto_start', v);
            }}
          />
          {t('settings.mcp.autoStart')}
        </label>
        <div className="form-field">
          <label htmlFor="mcp-max-concurrent">{t('settings.mcp.maxConcurrent')}</label>
          <FieldInput
            id="mcp-max-concurrent"
            data-testid="mcp-max-concurrent"
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
            onBlur={() => {
              const n = Number(maxConcurrent);
              if (Number.isFinite(n) && n >= 1 && n <= 16) {
                void window.jarvis.settingsSet('mcp.max_concurrent_tools', Math.floor(n));
              }
            }}
          />
        </div>
      </section>

      <div className="provider-add-area" data-testid="mcp-add-area">
        <div className="form-stack">
          <div className="form-field">
            <label htmlFor="mcp-name">{t('settings.mcp.name')}</label>
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
            <label htmlFor="mcp-transport">{t('settings.mcp.transport')}</label>
            <select
              id="mcp-transport"
              data-testid="mcp-transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value as Transport)}
            >
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="http">streamable-http</option>
            </select>
          </div>
          {transport === 'stdio' ? (
            <>
              <div className="form-field">
                <label htmlFor="mcp-command">{t('settings.mcp.command')}</label>
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
              <div className="form-field">
                <label htmlFor="mcp-cwd">{t('settings.mcp.cwd')}</label>
                <FieldInput id="mcp-cwd" data-testid="mcp-cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="form-field">
              <label htmlFor="mcp-url">{t('settings.mcp.url')}</label>
              <FieldInput
                id="mcp-url"
                data-testid="mcp-url"
                value={url}
                error={fieldErrors.url}
                errorTestId="mcp-url-error"
                onChange={(e) => {
                  setUrl(e.target.value);
                  clearFieldError('url');
                }}
              />
            </div>
          )}
          <div className="form-field">
            <label htmlFor="mcp-description">{t('settings.mcp.description')}</label>
            <FieldInput id="mcp-description" data-testid="mcp-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="mcp-timeout">{t('settings.mcp.timeout')}</label>
            <FieldInput id="mcp-timeout" data-testid="mcp-timeout" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="mcp-auto-approve">{t('settings.mcp.autoApprove')}</label>
            <FieldInput id="mcp-auto-approve" data-testid="mcp-auto-approve" value={autoApprove} onChange={(e) => setAutoApprove(e.target.value)} />
          </div>
          {fieldErrors.form ? (
            <p data-testid="mcp-form-error" role="alert" className="form-field__error">{fieldErrors.form}</p>
          ) : null}
          <div className="toolbar-row">
            <Button variant="primary" data-testid="mcp-add" onClick={() => void save()}>
              {editingId ? t('settings.mcp.save') : t('settings.mcp.add')}
            </Button>
            {editingId ? (
              <Button variant="ghost" data-testid="mcp-cancel-edit" onClick={resetForm}>
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <section className="form-stack" data-testid="mcp-io">
        <h2 className="settings-section-title">{t('settings.mcp.ioTitle')}</h2>
        <textarea data-testid="mcp-import-text" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} />
        <div className="toolbar-row">
          <Button
            variant="ghost"
            data-testid="mcp-load-sample"
            onClick={() => setImportText(JSON.stringify(SAMPLE, null, 2))}
          >
            {t('settings.mcp.loadSample')}
          </Button>
          <Button
            variant="ghost"
            data-testid="mcp-import"
            onClick={() => {
              void window.jarvis.invoke('mcp.import', { text: importText, strategy: 'skip' }).then((res) => {
                const r = res as { ok?: boolean; imported?: number; error?: string };
                setIoMsg(r.ok ? t('settings.mcp.importOk', { count: r.imported ?? 0 }) : (r.error ?? ''));
                void refresh();
              });
            }}
          >
            {t('settings.mcp.import')}
          </Button>
          <Button
            variant="ghost"
            data-testid="mcp-export"
            onClick={() => {
              void window.jarvis.invoke('mcp.export').then((res) => {
                const r = res as { ok?: boolean; document?: unknown };
                if (r.ok) setImportText(JSON.stringify(r.document, null, 2));
              });
            }}
          >
            {t('settings.mcp.export')}
          </Button>
        </div>
        {ioMsg ? <p data-testid="mcp-io-msg">{ioMsg}</p> : null}
      </section>

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

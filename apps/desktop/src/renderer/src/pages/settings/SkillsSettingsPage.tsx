import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Modal, ModalMessage, PageHeader } from '@jarvis/ui';
import { SKILL_FIELD_MAX } from '@jarvis/protocol';
import { FieldInput } from '../../components/settings/FieldInput';
import { EnableToggle } from '../../components/EnableToggle';
import { IconTrash } from '../../components/shell/ShellIcons';

type SkillRow = {
  id: string;
  name: string;
  path: string;
  description: string;
  enabled?: boolean;
};

const SKILL_ERROR_KEYS: Record<string, string> = {
  SKILL_NAME_INVALID: 'settings.skills.errors.nameInvalid',
  SKILL_EXISTS: 'settings.skills.errors.exists',
  SKILL_CONTENT_TYPE: 'settings.skills.errors.contentType',
  SKILL_PATH_ESCAPE: 'settings.skills.errors.pathEscape',
  SKILL_URL_REQUIRED: 'settings.skills.errors.urlRequired',
  SKILL_URL_TOO_LONG: 'settings.skills.errors.urlTooLong',
  SKILL_URL_PROTOCOL: 'settings.skills.errors.urlProtocol',
};

function mapSkillError(
  code: string | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!code) return t('settings.skills.importFailed');
  if (code === 'SKILL_URL_TOO_LONG') {
    return t('settings.skills.errors.urlTooLong', { max: SKILL_FIELD_MAX.url });
  }
  const key = SKILL_ERROR_KEYS[code];
  return key ? t(key) : t('settings.skills.importFailed');
}

export function SkillsSettingsPage() {
  const { t } = useTranslation('common');
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<SkillRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const refresh = useCallback(async () => {
    setSkills((await window.jarvis.invoke('skills.list')) as SkillRow[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const pickImport = async () => {
    const caps = (await window.jarvis.invoke('dialog.pickPath', { purpose: 'skills-import' })) as Array<{ token: string }>;
    const cap = caps[0];
    if (cap) {
      try {
        await window.jarvis.invoke('skills.importLocal', { capability: cap.token });
        setError('');
        await refresh();
      } catch (e) {
        setError(mapSkillError(e instanceof Error ? e.message : undefined, t));
      }
    }
  };

  const importUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlError(t('settings.skills.errors.urlRequired'));
      return;
    }
    if (trimmed.length > SKILL_FIELD_MAX.url) {
      setUrlError(t('settings.skills.errors.urlTooLong', { max: SKILL_FIELD_MAX.url }));
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setUrlError(t('settings.skills.errors.urlProtocol'));
      return;
    }
    setUrlError(null);
    const result = (await window.jarvis.invoke('skills.importUrl', { url: trimmed })) as {
      ok: boolean;
      error?: string;
    };
    if (!result.ok) {
      setError(mapSkillError(result.error, t));
      return;
    }
    setError('');
    setUrl('');
    await refresh();
  };

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: t('settings.skills.colName'),
        render: (row: SkillRow) => (
          <span data-testid={`skill-${row.id}`} title={row.name}>{row.name}</span>
        ),
      },
      {
        key: 'path',
        header: t('settings.skills.colPath'),
        render: (row: SkillRow) => (
          <span title={row.path}>{row.path}</span>
        ),
      },
      {
        key: 'enabled',
        header: t('settings.skills.colEnabled'),
        render: (row: SkillRow) => (
          <EnableToggle
            enabled={row.enabled !== false}
            testId={`skill-enabled-${row.id}`}
            aria-label={row.enabled !== false ? t('settings.skills.disable') : t('settings.skills.enable')}
            onChange={(next) => {
              void window.jarvis.invoke('skills.setEnabled', row.id, next).then(async (res) => {
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
        header: t('settings.skills.colActions'),
        render: (row: SkillRow) => (
          <Button
            variant="ghost"
            size="sm"
            className="provider-icon-btn provider-icon-btn--delete"
            data-testid={`skill-delete-${row.id}`}
            aria-label={t('settings.skills.remove')}
            onClick={() => setDeleting(row)}
          >
            <IconTrash />
          </Button>
        ),
      },
    ],
    [refresh, t],
  );

  return (
    <div data-testid="skills-settings" className="page form-stack settings-page">
      <PageHeader
        title={t('settings.skills.title')}
        subtitle={t('settings.skills.subtitle')}
        actions={
          <Button variant="primary" data-testid="skills-import" onClick={() => void pickImport()}>
            {t('settings.skills.importLocal')}
          </Button>
        }
      />
      <div className="provider-add-area form-stack" data-testid="skills-url-area">
        <div className="form-field">
          <label htmlFor="skills-url-input">{t('settings.skills.url')}</label>
          <p className="form-field__hint form-field__hint--1line" title={t('settings.skills.urlHint')}>
            {t('settings.skills.urlHint')}
          </p>
          <FieldInput
            id="skills-url-input"
            data-testid="skills-url-input"
            value={url}
            maxLength={SKILL_FIELD_MAX.url}
            error={urlError ?? undefined}
            errorTestId="skills-url-error"
            placeholder={t('settings.skills.urlPlaceholder')}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
          />
        </div>
        <Button variant="ghost" data-testid="skills-import-url" onClick={() => void importUrl()}>
          {t('settings.skills.importUrl')}
        </Button>
      </div>
      {error ? <p data-testid="skills-import-error" className="form-field__error" role="alert">{error}</p> : null}
      {skills.length > 0 ? (
        <div data-testid="skills-list-section">
          <h2 className="settings-section-title">{t('settings.skills.listTitle')}</h2>
          <DataTable columns={columns} rows={skills} rowKey={(row) => row.id} />
        </div>
      ) : null}

      <Modal
        open={deleting != null}
        title={t('settings.skills.deleteTitle')}
        testId="skills-delete-modal"
        onClose={() => {
          if (deletingBusy) return;
          setDeleting(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid="skills-delete-cancel"
              disabled={deletingBusy}
              onClick={() => setDeleting(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="skills-delete-confirm"
              disabled={deletingBusy}
              onClick={() => {
                if (!deleting) return;
                setDeletingBusy(true);
                void window.jarvis
                  .invoke('skills.delete', deleting.id)
                  .then(async (res) => {
                    const result = res as { ok?: boolean } | undefined;
                    if (result && result.ok === false) return;
                    setDeleting(null);
                    await refresh();
                  })
                  .finally(() => setDeletingBusy(false));
              }}
            >
              {t('settings.skills.remove')}
            </Button>
          </>
        }
      >
        {deleting ? (
          <ModalMessage>{t('settings.skills.deleteConfirm', { name: deleting.name })}</ModalMessage>
        ) : null}
      </Modal>
    </div>
  );
}

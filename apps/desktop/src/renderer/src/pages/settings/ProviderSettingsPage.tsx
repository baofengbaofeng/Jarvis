import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Input, MenuSelect, Modal, ModalMessage, PageHeader } from '@jarvis/ui';
import {
  PROVIDER_FIELD_MAX,
  contextTokensFromInput,
  formatContextTokens,
  sanitizeProviderModelIdInput,
  sanitizeProviderModelNameInput,
  type ContextTokenUnit,
  type Model,
  type Provider,
} from '@jarvis/protocol';
import { useProviderStore } from '../../stores/provider-store';
import { ProviderForm } from './ProviderForm';
import { EnableToggle } from '../../components/EnableToggle';
import { IconLayers, IconPencil, IconPlus, IconTrash } from '../../components/shell/ShellIcons';

function sanitizeContextDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

type ModelDraft = {
  key: string;
  modelId: string;
  name: string;
  contextValue: string;
  contextUnit: ContextTokenUnit;
  maxOutputValue: string;
  supportsTools: boolean;
  supportsImages: boolean;
  /** Set when editing an existing model row (Model ID read-only). */
  editingId?: string;
};

function splitContextTokens(tokens: number | null | undefined): { contextValue: string; contextUnit: ContextTokenUnit } {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return { contextValue: '', contextUnit: 'K' };
  if (tokens % 1_000_000 === 0) return { contextValue: String(tokens / 1_000_000), contextUnit: 'M' };
  if (tokens % 1_000 === 0) return { contextValue: String(tokens / 1_000), contextUnit: 'K' };
  return { contextValue: '', contextUnit: 'K' };
}

function newModelDraft(): ModelDraft {
  return {
    key: crypto.randomUUID(),
    modelId: '',
    name: '',
    contextValue: '',
    contextUnit: 'K',
    maxOutputValue: '',
    supportsTools: true,
    supportsImages: false,
  };
}

function draftFromModel(model: Model): ModelDraft {
  const ctx = splitContextTokens(model.contextTokens);
  return {
    key: crypto.randomUUID(),
    modelId: model.modelId,
    name: model.name,
    contextValue: ctx.contextValue,
    contextUnit: ctx.contextUnit,
    maxOutputValue: model.maxOutputTokens != null ? String(model.maxOutputTokens) : '',
    supportsTools: model.supportsTools !== false,
    supportsImages: model.supportsImages === true,
    editingId: model.id,
  };
}

function mapModelPersistError(error: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (error === 'PROVIDER_MODEL_CONTEXT_INVALID') return t('settings.provider.errors.modelContextInvalid');
  if (error === 'PROVIDER_MODEL_MAX_OUTPUT_INVALID') return t('settings.provider.errors.modelMaxOutputInvalid');
  if (error === 'PROVIDER_MODEL_ID_REQUIRED') return t('settings.provider.errors.modelIdRequired');
  if (error === 'PROVIDER_MODEL_ID_TOO_LONG') return t('settings.provider.errors.modelIdTooLong', { max: PROVIDER_FIELD_MAX.modelId });
  if (error === 'PROVIDER_MODEL_ID_INVALID') return t('settings.provider.errors.modelIdInvalid');
  if (error === 'PROVIDER_MODEL_NAME_TOO_LONG') return t('settings.provider.errors.modelNameTooLong', { max: PROVIDER_FIELD_MAX.modelName });
  if (error === 'PROVIDER_MODEL_NAME_INVALID') return t('settings.provider.errors.modelNameInvalid');
  return t('settings.provider.errors.unknown');
}

function ProviderModels({
  providerId,
  onChange,
  onRequestDelete,
  modelsRevision = 0,
}: {
  providerId: string;
  onChange?: () => void;
  onRequestDelete: (model: Model) => void;
  /** Bump to reload the table after an external delete. */
  modelsRevision?: number;
}) {
  const { t } = useTranslation('common');
  const [models, setModels] = useState<Model[]>([]);
  const [drafts, setDrafts] = useState<ModelDraft[]>(() => [newModelDraft()]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const refresh = useCallback(async () => {
    const ms = (await window.jarvis.invoke('provider.listModels', providerId)) as Model[];
    setModels(ms);
  }, [providerId]);

  useEffect(() => { void refresh(); }, [refresh, modelsRevision]);

  const updateDraft = (key: string, patch: Partial<ModelDraft>) => {
    setDraftError(null);
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const beginEdit = (model: Model) => {
    setDraftError(null);
    setDrafts([draftFromModel(model)]);
  };

  const cancelEdit = (key: string) => {
    setDraftError(null);
    setDrafts((rows) => {
      const next = rows.filter((row) => row.key !== key);
      return next.length > 0 ? next : [newModelDraft()];
    });
  };

  const saveDraft = async (key: string) => {
    const draft = draftsRef.current.find((row) => row.key === key);
    if (!draft) return;
    const id = draft.modelId.trim();
    if (!draft.editingId) {
      if (!id) {
        setDraftError(t('settings.provider.errors.modelIdRequired'));
        return;
      }
      if (id.length > PROVIDER_FIELD_MAX.modelId) {
        setDraftError(t('settings.provider.errors.modelIdTooLong', { max: PROVIDER_FIELD_MAX.modelId }));
        return;
      }
    }
    const displayName = draft.name.trim();
    if (displayName.length > PROVIDER_FIELD_MAX.modelName) {
      setDraftError(t('settings.provider.errors.modelNameTooLong', { max: PROVIDER_FIELD_MAX.modelName }));
      return;
    }
    const digits = draft.contextValue.trim();
    let contextTokens: number | null = null;
    if (digits) {
      if (digits.length > PROVIDER_FIELD_MAX.contextDigits) {
        setDraftError(t('settings.provider.errors.modelContextInvalid'));
        return;
      }
      const n = Number(digits);
      if (!Number.isInteger(n) || n <= 0) {
        setDraftError(t('settings.provider.errors.modelContextInvalid'));
        return;
      }
      contextTokens = contextTokensFromInput(n, draft.contextUnit);
      if (contextTokens > PROVIDER_FIELD_MAX.contextTokens) {
        setDraftError(t('settings.provider.errors.modelContextInvalid'));
        return;
      }
    }
    const maxDigits = draft.maxOutputValue.trim();
    let maxOutputTokens: number | null = null;
    if (maxDigits) {
      const n = Number(maxDigits);
      if (!Number.isInteger(n) || n <= 0 || n > PROVIDER_FIELD_MAX.contextTokens) {
        setDraftError(t('settings.provider.errors.modelMaxOutputInvalid'));
        return;
      }
      maxOutputTokens = n;
    }
    setDraftError(null);
    const payload = {
      name: displayName || id,
      contextTokens,
      maxOutputTokens,
      supportsTools: draft.supportsTools,
      supportsImages: draft.supportsImages,
    };
    const res = draft.editingId
      ? ((await window.jarvis.invoke('provider.updateModel', draft.editingId, payload)) as
          | { ok: true; model: Model }
          | { ok: false; error: string })
      : ((await window.jarvis.invoke('provider.addModel', providerId, { modelId: id, ...payload })) as
          | { ok: true; model: Model }
          | { ok: false; error: string }
          | Model);
    if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
      setDraftError(mapModelPersistError(res.error, t));
      return;
    }
    setDrafts((rows) => {
      const next = rows.filter((row) => row.key !== key);
      return next.length > 0 ? next : [newModelDraft()];
    });
    await refresh();
    onChange?.();
  };

  const modelColumns = useMemo(
    () => [
      {
        key: 'modelId',
        header: t('settings.provider.modelId'),
        className: 'provider-models-table__id',
        render: (row: Model) => (
          <span data-testid={`provider-model-${row.id}`}>{row.modelId}</span>
        ),
      },
      {
        key: 'name',
        header: t('settings.provider.modelName'),
        className: 'provider-models-table__name',
        render: (row: Model) => row.name,
      },
      {
        key: 'context',
        header: t('settings.provider.modelContext'),
        className: 'provider-models-table__context',
        render: (row: Model) =>
          formatContextTokens(row.contextTokens) ?? t('settings.provider.modelsEmpty'),
      },
      {
        key: 'capabilities',
        header: t('settings.provider.modelCapabilities'),
        className: 'provider-models-table__capabilities',
        render: (row: Model) => (
          <span data-testid={`provider-model-caps-${row.id}`} className="provider-model-caps">
            <span className={`provider-model-cap${row.supportsTools === false ? ' provider-model-cap--off' : ''}`}>
              {t('settings.provider.capTools')}
            </span>
            <span className={`provider-model-cap${row.supportsImages === true ? '' : ' provider-model-cap--off'}`}>
              {t('settings.provider.capImages')}
            </span>
          </span>
        ),
      },
      {
        key: 'enabled',
        header: t('settings.provider.colEnabled'),
        className: 'provider-models-table__enabled',
        render: (row: Model) => (
          <EnableToggle
            enabled={row.enabled !== false}
            testId={`provider-model-enabled-${row.id}`}
            aria-label={row.enabled !== false ? t('settings.provider.disable') : t('settings.provider.enable')}
            onChange={(next) => {
              void window.jarvis
                .invoke('provider.setModelEnabled', row.id, next)
                .then(async (res) => {
                  const result = res as { ok?: boolean } | undefined;
                  if (result && result.ok === false) return;
                  await refresh();
                  onChange?.();
                });
            }}
          />
        ),
      },
      {
        key: 'actions',
        header: t('settings.provider.colActions'),
        className: 'provider-models-table__actions',
        render: (row: Model) => (
          <div className="provider-models-table__action-btn provider-models-table__action-btn--pair">
            <Button
              variant="ghost"
              size="sm"
              className="provider-icon-btn provider-icon-btn--edit"
              data-testid={`provider-model-edit-${row.id}`}
              aria-label={t('settings.provider.editModel')}
              onClick={() => beginEdit(row)}
            >
              <IconPencil />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="provider-icon-btn provider-icon-btn--delete"
              data-testid={`provider-model-delete-${row.id}`}
              aria-label={t('settings.provider.removeModel')}
              onClick={() => onRequestDelete(row)}
            >
              <IconTrash />
            </Button>
          </div>
        ),
      },
    ],
    [onChange, onRequestDelete, refresh, t],
  );

  const unitOptions = useMemo(
    () => [
      { value: 'K', label: t('settings.provider.modelContextUnitK') },
      { value: 'M', label: t('settings.provider.modelContextUnitM') },
    ],
    [t],
  );

  return (
    <div data-testid={`provider-models-${providerId}`} className="provider-models">
      <div className="provider-models__header">
        <span className="form-field__label">{t('settings.provider.models')}</span>
        <Button
          variant="ghost"
          size="sm"
          className="provider-icon-btn provider-icon-btn--edit"
          data-testid="provider-model-add-open"
          aria-label={t('settings.provider.addModel')}
          onClick={() => setDrafts((rows) => [...rows, newModelDraft()])}
        >
          <IconPlus />
        </Button>
      </div>
      <p className="form-field__hint form-field__hint--2line" title={t('settings.provider.modelsHint')}>
        {t('settings.provider.modelsHint')}
      </p>
      {draftError ? (
        <p className="form-field__error" data-testid="provider-model-add-error" role="alert">
          {draftError}
        </p>
      ) : null}
      {models.length > 0 ? (
        <div className="provider-models-table" data-testid="provider-models-table">
          <DataTable
            columns={modelColumns}
            rows={models}
            rowKey={(row) => row.id}
          />
        </div>
      ) : null}
      <div className="provider-models__drafts" data-testid="provider-model-drafts">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className="provider-models__draft-block"
            data-testid={`provider-model-add-row-${draft.key}`}
          >
            {draft.editingId ? (
              <p className="provider-models__editing-banner" data-testid={`provider-model-editing-${draft.key}`}>
                {t('settings.provider.editingModel', { modelId: draft.modelId })}
              </p>
            ) : null}
            <div className="provider-models__add-row">
              <label className="provider-models__inline-field" htmlFor={`provider-model-id-${draft.key}`}>
                <span className="form-field__label">{t('settings.provider.modelId')}</span>
                <Input
                  id={`provider-model-id-${draft.key}`}
                  data-testid={`provider-model-id-${draft.key}`}
                  value={draft.modelId}
                  maxLength={PROVIDER_FIELD_MAX.modelId}
                  readOnly={Boolean(draft.editingId)}
                  onChange={(e) => updateDraft(draft.key, { modelId: sanitizeProviderModelIdInput(e.target.value) })}
                />
              </label>
              <label className="provider-models__inline-field" htmlFor={`provider-model-name-${draft.key}`}>
                <span className="form-field__label">{t('settings.provider.modelName')}</span>
                <Input
                  id={`provider-model-name-${draft.key}`}
                  data-testid={`provider-model-name-${draft.key}`}
                  value={draft.name}
                  maxLength={PROVIDER_FIELD_MAX.modelName}
                  onChange={(e) => updateDraft(draft.key, { name: sanitizeProviderModelNameInput(e.target.value) })}
                />
              </label>
              <label
                className="provider-models__inline-field provider-models__inline-field--context"
                htmlFor={`provider-model-context-${draft.key}`}
              >
                <span className="form-field__label">{t('settings.provider.modelContext')}</span>
                <Input
                  id={`provider-model-context-${draft.key}`}
                  data-testid={`provider-model-context-${draft.key}`}
                  inputMode="numeric"
                  value={draft.contextValue}
                  maxLength={PROVIDER_FIELD_MAX.contextDigits}
                  onChange={(e) => updateDraft(draft.key, { contextValue: sanitizeContextDigits(e.target.value) })}
                />
                <MenuSelect
                  testId={`provider-model-context-unit-${draft.key}`}
                  aria-label={t('settings.provider.modelContextUnit')}
                  value={draft.contextUnit}
                  options={unitOptions}
                  onChange={(v) => updateDraft(draft.key, { contextUnit: v as ContextTokenUnit })}
                />
              </label>
            </div>
            <div className="provider-models__add-row provider-models__add-row--caps">
              <label className="provider-models__inline-field provider-models__inline-field--max" htmlFor={`provider-model-max-${draft.key}`}>
                <span className="form-field__label">{t('settings.provider.modelMaxOutput')}</span>
                <Input
                  id={`provider-model-max-${draft.key}`}
                  data-testid={`provider-model-max-${draft.key}`}
                  inputMode="numeric"
                  placeholder={t('settings.provider.modelMaxOutputPlaceholder')}
                  value={draft.maxOutputValue}
                  maxLength={PROVIDER_FIELD_MAX.contextDigits}
                  onChange={(e) => updateDraft(draft.key, { maxOutputValue: sanitizeContextDigits(e.target.value) })}
                />
              </label>
              <label className="provider-models__switch" data-testid={`provider-model-tools-${draft.key}`}>
                <EnableToggle
                  enabled={draft.supportsTools}
                  testId={`provider-model-tools-toggle-${draft.key}`}
                  aria-label={t('settings.provider.modelSupportsTools')}
                  onChange={(next) => updateDraft(draft.key, { supportsTools: next })}
                />
                <span>{t('settings.provider.modelSupportsTools')}</span>
              </label>
              <label className="provider-models__switch" data-testid={`provider-model-images-${draft.key}`}>
                <EnableToggle
                  enabled={draft.supportsImages}
                  testId={`provider-model-images-toggle-${draft.key}`}
                  aria-label={t('settings.provider.modelSupportsImages')}
                  onChange={(next) => updateDraft(draft.key, { supportsImages: next })}
                />
                <span>{t('settings.provider.modelSupportsImages')}</span>
              </label>
              {draft.editingId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`provider-model-cancel-${draft.key}`}
                  onClick={() => cancelEdit(draft.key)}
                >
                  {t('settings.provider.cancelEditModel')}
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                data-testid={`provider-model-add-${draft.key}`}
                onClick={() => void saveDraft(draft.key)}
              >
                {t('settings.provider.saveModel')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function modelLabel(m: Model): string {
  return m.name?.trim() || m.modelId;
}

export function ProviderSettingsPage() {
  const { t } = useTranslation('common');
  const { providers, refresh, remove, setEnabled } = useProviderStore();
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, Model[]>>({});
  const [editing, setEditing] = useState<Provider | null>(null);
  const [editingModels, setEditingModels] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<Model | null>(null);
  const [deletingModelBusy, setDeletingModelBusy] = useState(false);
  const [modelsRevision, setModelsRevision] = useState(0);

  const loadModels = useCallback(async (list: Provider[]) => {
    const entries = await Promise.all(
      list.map(async (p) => {
        const models = (await window.jarvis.invoke('provider.listModels', p.id)) as Model[];
        return [p.id, models] as const;
      }),
    );
    setModelsByProvider(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    void loadModels(providers);
  }, [providers, loadModels]);

  const typeLabel = useCallback(
    (type: Provider['type']) =>
      type === 'anthropic-compatible'
        ? t('settings.provider.typeAnthropic')
        : t('settings.provider.typeOpenai'),
    [t],
  );

  // Column widths track PROVIDER_FIELD_MAX / type enum max lengths (see desktop.css).
  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: t('settings.provider.colName'),
        className: 'provider-table__name',
        render: (row: Provider) => (
          <span className="provider-table__cell-text" title={row.name} data-testid={`provider-name-cell-${row.id}`}>
            {row.name}
          </span>
        ),
      },
      {
        key: 'type',
        header: t('settings.provider.colType'),
        className: 'provider-table__type',
        render: (row: Provider) => {
          const label = typeLabel(row.type);
          return (
            <span className="provider-table__cell-text" title={label} data-testid={`provider-type-label-${row.id}`}>
              {label}
            </span>
          );
        },
      },
      {
        key: 'models',
        header: t('settings.provider.colModels'),
        className: 'provider-table__models',
        render: (row: Provider) => {
          const models = modelsByProvider[row.id] ?? [];
          const text = models.length
            ? models.map(modelLabel).join(', ')
            : t('settings.provider.modelsEmpty');
          return (
            <span className="provider-table__cell-text" title={text} data-testid={`provider-models-cell-${row.id}`}>
              {text}
            </span>
          );
        },
      },
      {
        key: 'enabled',
        header: t('settings.provider.colEnabled'),
        className: 'provider-table__enabled',
        render: (row: Provider) => (
          <EnableToggle
            enabled={row.enabled !== false}
            testId={`provider-enabled-${row.id}`}
            aria-label={row.enabled !== false ? t('settings.provider.disable') : t('settings.provider.enable')}
            onChange={(next) => {
              void setEnabled(row.id, next);
            }}
          />
        ),
      },
      {
        key: 'actions',
        header: t('settings.provider.colActions'),
        className: 'provider-table__actions',
        render: (row: Provider) => (
          <div className="provider-table__action-btns">
            <Button
              variant="ghost"
              size="sm"
              className="provider-icon-btn provider-icon-btn--edit"
              data-testid={`provider-edit-models-${row.id}`}
              aria-label={t('settings.provider.editModels')}
              onClick={() => setEditingModels(row)}
            >
              <IconLayers />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="provider-icon-btn provider-icon-btn--edit"
              data-testid={`provider-edit-${row.id}`}
              aria-label={t('settings.provider.edit')}
              onClick={() => setEditing(row)}
            >
              <IconPencil />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="provider-icon-btn provider-icon-btn--delete"
              data-testid={`provider-delete-${row.id}`}
              aria-label={t('settings.provider.remove')}
              onClick={() => {
                setDeleteError(null);
                setDeleting(row);
              }}
            >
              <IconTrash />
            </Button>
          </div>
        ),
      },
    ],
    [modelsByProvider, setEnabled, t, typeLabel],
  );

  return (
    <div data-testid="provider-settings" className="page settings-page">
      <PageHeader
        title={t('settings.provider.title')}
        subtitle={t('settings.provider.description')}
      />
      <div data-testid="provider-add-area" className="provider-add-area">
        <ProviderForm />
      </div>
      {providers.length > 0 ? (
        <div data-testid="provider-list-section" className="provider-list-section">
          <hr className="provider-list-section__divider" />
          <h3 className="provider-list-section__title">{t('settings.provider.listTitle')}</h3>
          <div data-testid="provider-table" className="provider-table">
            <DataTable
              columns={columns}
              rows={providers}
              rowKey={(row) => row.id}
            />
          </div>
        </div>
      ) : null}
      <Modal
        open={editing != null}
        title={t('settings.provider.editTitle')}
        testId="provider-edit-modal"
        closeLabel={t('common.close')}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <div className="provider-edit-modal__body">
            <ProviderForm
              key={editing.id}
              provider={editing}
              idPrefix="provider-edit"
              onCancel={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                void refresh().then(() => loadModels(useProviderStore.getState().providers));
              }}
            />
            <hr className="provider-edit-modal__divider" />
            <ProviderModels
              providerId={editing.id}
              modelsRevision={modelsRevision}
              onChange={() => {
                void loadModels(useProviderStore.getState().providers);
              }}
              onRequestDelete={setDeletingModel}
            />
          </div>
        ) : null}
      </Modal>
      <Modal
        open={editingModels != null}
        title={t('settings.provider.editModelsTitle')}
        testId="provider-models-modal"
        closeLabel={t('common.close')}
        onClose={() => setEditingModels(null)}
      >
        {editingModels ? (
          <div className="provider-models-modal__body">
            <ProviderModels
              key={editingModels.id}
              providerId={editingModels.id}
              modelsRevision={modelsRevision}
              onChange={() => {
                void loadModels(useProviderStore.getState().providers);
              }}
              onRequestDelete={setDeletingModel}
            />
          </div>
        ) : null}
      </Modal>
      <Modal
        open={deletingModel != null}
        title={t('settings.provider.deleteModelTitle')}
        testId="provider-model-delete-modal"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid="provider-model-delete-cancel"
              disabled={deletingModelBusy}
              onClick={() => setDeletingModel(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="provider-model-delete-confirm"
              disabled={deletingModelBusy}
              onClick={() => {
                if (!deletingModel) return;
                setDeletingModelBusy(true);
                void window.jarvis
                  .invoke('provider.deleteModel', deletingModel.id)
                  .then(async (res) => {
                    const result = res as { ok?: boolean; error?: string } | undefined;
                    if (result && result.ok === false) return;
                    setDeletingModel(null);
                    setModelsRevision((n) => n + 1);
                    void loadModels(useProviderStore.getState().providers);
                  })
                  .finally(() => setDeletingModelBusy(false));
              }}
            >
              {t('settings.provider.removeModel')}
            </Button>
          </>
        }
      >
        {deletingModel ? (
          <ModalMessage testId="provider-model-delete-message">
            {t('settings.provider.deleteModelConfirm', {
              name: deletingModel.name?.trim() || deletingModel.modelId,
            })}
          </ModalMessage>
        ) : null}
      </Modal>
      <Modal
        open={deleting != null}
        title={t('settings.provider.deleteTitle')}
        testId="provider-delete-modal"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid="provider-delete-cancel"
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
              data-testid="provider-delete-confirm"
              disabled={deletingBusy}
              onClick={() => {
                if (!deleting) return;
                setDeletingBusy(true);
                setDeleteError(null);
                void remove(deleting.id)
                  .then(() => {
                    setDeleting(null);
                    void loadModels(useProviderStore.getState().providers);
                  })
                  .catch((err: unknown) => {
                    const code = err instanceof Error ? err.message : String(err);
                    setDeleteError(
                      code === 'PROVIDER_HAS_MODELS'
                        ? t('settings.provider.deleteBlockedHasModels')
                        : t('settings.provider.errors.unknown'),
                    );
                  })
                  .finally(() => setDeletingBusy(false));
              }}
            >
              {t('settings.provider.remove')}
            </Button>
          </>
        }
      >
        {deleting ? (
          <>
            <ModalMessage testId="provider-delete-message">
              {t('settings.provider.deleteConfirm', { name: deleting.name })}
            </ModalMessage>
            {deleteError ? (
              <ModalMessage testId="provider-delete-error" className="form-field__error provider-delete-error">
                {deleteError}
              </ModalMessage>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

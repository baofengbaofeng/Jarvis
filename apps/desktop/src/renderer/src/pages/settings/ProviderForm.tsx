import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@jarvis/ui';
import {
  PROVIDER_FIELD_MAX,
  isValidProviderName,
  providerBaseUrlError,
  sanitizeProviderNameInput,
  type Provider,
} from '@jarvis/protocol';
import { useProviderStore } from '../../stores/provider-store';

type ProviderType = 'openai-compatible' | 'anthropic-compatible';
type FieldKey = 'name' | 'baseUrl' | 'apiKey' | 'form';

function fieldForError(code: string): FieldKey {
  switch (code) {
    case 'PROVIDER_NAME_REQUIRED':
    case 'PROVIDER_NAME_DUPLICATE':
    case 'PROVIDER_NAME_INVALID':
    case 'PROVIDER_NAME_TOO_LONG':
      return 'name';
    case 'URL_PROTOCOL_REQUIRED':
    case 'URL_HTTPS_REQUIRED':
    case 'URL_INVALID':
    case 'URL_CREDENTIALS_FORBIDDEN':
    case 'PROVIDER_BASE_URL_TOO_LONG':
      return 'baseUrl';
    case 'PROVIDER_API_KEY_REQUIRED':
    case 'PROVIDER_API_KEY_TOO_LONG':
    case 'secure storage unavailable on this platform':
      return 'apiKey';
    default:
      return 'form';
  }
}

function mapProviderError(code: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (code) {
    case 'URL_PROTOCOL_REQUIRED':
    case 'URL_HTTPS_REQUIRED':
      return t('settings.provider.errors.protocolRequired');
    case 'URL_INVALID':
      return t('settings.provider.errors.urlInvalid');
    case 'URL_CREDENTIALS_FORBIDDEN':
      return t('settings.provider.errors.credentialsForbidden');
    case 'PROVIDER_NAME_REQUIRED':
      return t('settings.provider.errors.nameRequired');
    case 'PROVIDER_NAME_DUPLICATE':
      return t('settings.provider.errors.nameDuplicate');
    case 'PROVIDER_NAME_INVALID':
      return t('settings.provider.errors.nameInvalid');
    case 'PROVIDER_NAME_TOO_LONG':
      return t('settings.provider.errors.nameTooLong', { max: PROVIDER_FIELD_MAX.name });
    case 'PROVIDER_BASE_URL_TOO_LONG':
      return t('settings.provider.errors.baseUrlTooLong', { max: PROVIDER_FIELD_MAX.baseUrl });
    case 'PROVIDER_API_KEY_REQUIRED':
      return t('settings.provider.errors.apiKeyRequired');
    case 'PROVIDER_API_KEY_TOO_LONG':
      return t('settings.provider.errors.apiKeyTooLong', { max: PROVIDER_FIELD_MAX.apiKey });
    case 'secure storage unavailable on this platform':
      return t('settings.provider.errors.secureStorage');
    default:
      return code || t('settings.provider.errors.unknown');
  }
}

/** Value + in-box validation error (help text stays outside under the label). */
function FieldInput({
  error,
  errorTestId,
  placeholder,
  ...inputProps
}: {
  error?: string;
  errorTestId: string;
  placeholder?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'>) {
  const invalid = Boolean(error);
  return (
    <div
      className={['form-input-shell', invalid ? 'form-input-shell--invalid' : ''].filter(Boolean).join(' ')}
    >
      <Input
        {...inputProps}
        placeholder={placeholder}
        aria-invalid={invalid}
        className="form-input-shell__input"
      />
      {error ? (
        <p data-testid={errorTestId} role="alert" className="form-input-shell__error">{error}</p>
      ) : null}
    </div>
  );
}

export type ProviderFormProps = {
  /** When set, form updates this provider; token optional. */
  provider?: Provider;
  onDone?: () => void;
  onCancel?: () => void;
  /** Prefix for ids/testids so create + edit can coexist. Default `provider`. */
  idPrefix?: string;
};

export function ProviderForm({ provider, onDone, onCancel, idPrefix = 'provider' }: ProviderFormProps) {
  const { t } = useTranslation('common');
  const create = useProviderStore((s) => s.create);
  const update = useProviderStore((s) => s.update);
  const providers = useProviderStore((s) => s.providers);
  const editing = provider != null;
  const [name, setName] = useState(() => sanitizeProviderNameInput(provider?.name ?? ''));
  const [type, setType] = useState<ProviderType>(provider?.type ?? 'anthropic-compatible');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);

  const tid = (suffix: string) => `${idPrefix}-${suffix}`;
  const apiKeyHint = editing ? t('settings.provider.apiKeyHintEdit') : t('settings.provider.apiKeyHint');

  const clearFieldError = (key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const reset = () => {
    setName(sanitizeProviderNameInput(provider?.name ?? ''));
    setType(provider?.type ?? 'anthropic-compatible');
    setBaseUrl(provider?.baseUrl ?? '');
    setApiKey('');
    setFieldErrors({});
  };

  const handleCancel = () => {
    reset();
    onCancel?.();
  };

  const submit = async () => {
    // Validate in form fill order: name → address → secret key (first failure wins).
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldErrors({ name: t('settings.provider.errors.nameRequired') });
      return;
    }
    if (!isValidProviderName(trimmedName)) {
      setFieldErrors({ name: t('settings.provider.errors.nameInvalid') });
      return;
    }
    if (trimmedName.length > PROVIDER_FIELD_MAX.name) {
      setFieldErrors({ name: t('settings.provider.errors.nameTooLong', { max: PROVIDER_FIELD_MAX.name }) });
      return;
    }
    if (providers.some((p) => p.name === trimmedName && p.id !== provider?.id)) {
      setFieldErrors({ name: t('settings.provider.errors.nameDuplicate') });
      return;
    }
    const trimmedBaseUrl = baseUrl.trim();
    if (trimmedBaseUrl.length > PROVIDER_FIELD_MAX.baseUrl) {
      setFieldErrors({ baseUrl: t('settings.provider.errors.baseUrlTooLong', { max: PROVIDER_FIELD_MAX.baseUrl }) });
      return;
    }
    const urlCode = providerBaseUrlError(baseUrl);
    if (urlCode) {
      setFieldErrors({ baseUrl: mapProviderError(urlCode, t) });
      return;
    }
    if (!editing && !apiKey.trim()) {
      setFieldErrors({ apiKey: t('settings.provider.errors.apiKeyRequired') });
      return;
    }
    if (apiKey.length > PROVIDER_FIELD_MAX.apiKey) {
      setFieldErrors({ apiKey: t('settings.provider.errors.apiKeyTooLong', { max: PROVIDER_FIELD_MAX.apiKey }) });
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      if (editing) {
        const patch: {
          name: string;
          type: ProviderType;
          baseUrl: string;
          apiKey?: string;
        } = {
          name: trimmedName,
          type,
          baseUrl: trimmedBaseUrl,
        };
        if (apiKey.trim()) patch.apiKey = apiKey.trim();
        await update(provider.id, patch);
      } else {
        await create({ name: trimmedName, type, baseUrl: trimmedBaseUrl, apiKey: apiKey.trim() });
        reset();
      }
      onDone?.();
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      const field = fieldForError(code);
      setFieldErrors({ [field]: mapProviderError(code, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-stack provider-form" data-testid={editing ? `${idPrefix}-form` : 'provider-form'}>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor={tid('name')}>{t('settings.provider.name')}</label>
          <p className="form-field__hint form-field__hint--2line" title={t('settings.provider.nameHint')}>
            {t('settings.provider.nameHint')}
          </p>
          <FieldInput
            id={tid('name')}
            data-testid={tid('name')}
            value={name}
            maxLength={PROVIDER_FIELD_MAX.name}
            error={fieldErrors.name}
            errorTestId={tid('name-error')}
            onChange={(e) => {
              setName(sanitizeProviderNameInput(e.target.value));
              clearFieldError('name');
            }}
          />
        </div>
        <div className="form-field">
          <span className="form-field__label" id={tid('type-label')}>{t('settings.provider.type')}</span>
          <p className="form-field__hint form-field__hint--2line" title={t('settings.provider.typeHint')}>
            {t('settings.provider.typeHint')}
          </p>
          <div
            className="radio-group"
            data-testid={tid('type')}
            role="radiogroup"
            aria-labelledby={tid('type-label')}
          >
            <label className="radio-label">
              <input
                type="radio"
                name={tid('type')}
                data-testid={tid('type-anthropic-compatible')}
                value="anthropic-compatible"
                checked={type === 'anthropic-compatible'}
                onChange={() => setType('anthropic-compatible')}
              />
              {t('settings.provider.typeAnthropic')}
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name={tid('type')}
                data-testid={tid('type-openai-compatible')}
                value="openai-compatible"
                checked={type === 'openai-compatible'}
                onChange={() => setType('openai-compatible')}
              />
              {t('settings.provider.typeOpenai')}
            </label>
          </div>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={tid('baseurl')}>{t('settings.provider.baseUrl')}</label>
        <p className="form-field__hint form-field__hint--1line" title={t('settings.provider.baseUrlHint')}>
          {t('settings.provider.baseUrlHint')}
        </p>
        <FieldInput
          id={tid('baseurl')}
          data-testid={tid('baseurl')}
          value={baseUrl}
          maxLength={PROVIDER_FIELD_MAX.baseUrl}
          error={fieldErrors.baseUrl}
          errorTestId={tid('baseurl-error')}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            clearFieldError('baseUrl');
          }}
        />
      </div>
      <div className="form-field">
        <label htmlFor={tid('apikey')}>{t('settings.provider.apiKey')}</label>
        <p className="form-field__hint form-field__hint--2line" title={apiKeyHint}>
          {apiKeyHint}
        </p>
        <FieldInput
          id={tid('apikey')}
          data-testid={tid('apikey')}
          type="password"
          value={apiKey}
          maxLength={PROVIDER_FIELD_MAX.apiKey}
          error={fieldErrors.apiKey}
          errorTestId={tid('apikey-error')}
          onChange={(e) => {
            setApiKey(e.target.value);
            clearFieldError('apiKey');
          }}
        />
      </div>
      {fieldErrors.form ? (
        <p data-testid={tid('form-error')} role="alert" className="form-field__error">{fieldErrors.form}</p>
      ) : null}
      <div className="form-actions">
        <Button variant="ghost" size="sm" data-testid={tid('cancel')} disabled={saving} onClick={handleCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" data-testid={tid('save')} disabled={saving} onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

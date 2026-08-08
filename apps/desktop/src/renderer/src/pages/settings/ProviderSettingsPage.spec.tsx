import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ProviderSettingsPage } from './ProviderSettingsPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => {
  cleanup();
});

describe('ProviderSettingsPage', () => {
  it('renders created provider after form submit', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => {
        if (method === 'provider.list') return [];
        if (method === 'provider.create') {
          return {
            ok: true,
            provider: { id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
          };
        }
        return [];
      }
    };
    render(<ProviderSettingsPage />);
    expect(screen.getByTestId('provider-add-area')).toBeTruthy();
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'My-Provider' } });
    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'https://x.com' } });
    fireEvent.change(screen.getByTestId('provider-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByText('My-Provider')).toBeTruthy());
  });

  it('shows an error when address lacks http(s) prefix', async () => {
    const invoke = vi.fn(async (method: string) => (method === 'provider.list' ? [] : []));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ProviderSettingsPage />);
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'api.example.com' } });
    fireEvent.change(screen.getByTestId('provider-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByTestId('provider-baseurl-error').textContent).toMatch(/http/i));
    expect(invoke).not.toHaveBeenCalledWith('provider.create', expect.anything());
  });

  it('leaves address placeholder empty', () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => (method === 'provider.list' ? [] : []),
      onDidReceive: () => () => {},
    };
    render(<ProviderSettingsPage />);
    expect((screen.getByTestId('provider-baseurl') as HTMLInputElement).placeholder).toBe('');
  });

  it('hides the provider list section when there are no providers', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => (method === 'provider.list' ? [] : []),
      onDidReceive: () => () => {},
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-add-area')).toBeTruthy());
    expect(screen.queryByTestId('provider-list-section')).toBeNull();
    expect(screen.queryByTestId('provider-table')).toBeNull();
  });

  it('strips disallowed characters from provider name input', () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => (method === 'provider.list' ? [] : []),
      onDidReceive: () => () => {},
    };
    render(<ProviderSettingsPage />);
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'GPT-4 测试!' } });
    expect((screen.getByTestId('provider-name') as HTMLInputElement).value).toBe('GPT-4测试');
  });

  it('applies maxlength from PROVIDER_FIELD_MAX on name, address, and token inputs', () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => (method === 'provider.list' ? [] : []),
      onDidReceive: () => () => {},
    };
    render(<ProviderSettingsPage />);
    expect((screen.getByTestId('provider-name') as HTMLInputElement).maxLength).toBe(64);
    expect((screen.getByTestId('provider-baseurl') as HTMLInputElement).maxLength).toBe(2048);
    expect((screen.getByTestId('provider-apikey') as HTMLInputElement).maxLength).toBe(512);
  });

  it('requires a secret key before create', async () => {
    const invoke = vi.fn(async (method: string) => (method === 'provider.list' ? [] : []));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ProviderSettingsPage />);
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'NoKey' } });
    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'https://x.com' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByTestId('provider-apikey-error').textContent).toMatch(/秘钥/));
    expect(invoke).not.toHaveBeenCalledWith('provider.create', expect.anything());
  });

  it('rejects a duplicate provider name before create', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'provider.list') {
        return [{ id: 'p1', name: 'DeepSeek', type: 'openai-compatible', baseUrl: 'https://a.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' }];
      }
      return [];
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy());
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'DeepSeek' } });
    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'https://b.com' } });
    fireEvent.change(screen.getByTestId('provider-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByTestId('provider-name-error').textContent).toMatch(/已存在/));
    expect(invoke).not.toHaveBeenCalledWith('provider.create', expect.anything());
  });

  it('validates fields in fill order (name before address before secret key)', async () => {
    const invoke = vi.fn(async (method: string) => (method === 'provider.list' ? [] : []));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ProviderSettingsPage />);
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByTestId('provider-name-error')).toBeTruthy());
    expect(screen.queryByTestId('provider-baseurl-error')).toBeNull();
    expect(screen.queryByTestId('provider-apikey-error')).toBeNull();

    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'Ordered' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByTestId('provider-baseurl-error')).toBeTruthy());
    expect(screen.queryByTestId('provider-name-error')).toBeNull();
    expect(screen.queryByTestId('provider-apikey-error')).toBeNull();

    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'https://x.com' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByTestId('provider-apikey-error')).toBeTruthy());
    expect(screen.queryByTestId('provider-baseurl-error')).toBeNull();
  });

  it('persists Anthropic-compatible type when that option is selected', async () => {
    const created: Array<Record<string, unknown>> = [];
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') return [];
        if (method === 'provider.create') {
          const input = args[0] as {
            name: string;
            type: string;
            baseUrl: string;
            apiKey: string;
          };
          created.push(input);
          return {
            ok: true,
            provider: {
              id: 'p-anthropic',
              name: input.name,
              type: input.type,
              baseUrl: input.baseUrl,
              apiKeyRef: 'k',
              createdAt: '',
              updatedAt: '',
            },
          };
        }
        if (method === 'provider.listModels') return [];
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    expect(screen.getByTestId('provider-type')).toBeTruthy();
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'DeepSeek' } });
    fireEvent.click(screen.getByTestId('provider-type-anthropic-compatible'));
    fireEvent.change(screen.getByTestId('provider-baseurl'), {
      target: { value: 'https://api.deepseek.com/anthropic' },
    });
    fireEvent.change(screen.getByTestId('provider-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy());
    expect(created).toEqual([
      {
        name: 'DeepSeek',
        type: 'anthropic-compatible',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-x',
      },
    ]);
    expect(screen.getByTestId('provider-type-label-p-anthropic').textContent).toBe('Anthropic');
  });

  it('confirms delete in a modal instead of window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    let list = [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible' as const, baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '', enabled: true }];
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') return list;
        if (method === 'provider.listModels') return [];
        if (method === 'provider.delete') {
          list = list.filter((p) => p.id !== args[0]);
          return { ok: true };
        }
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-delete-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('provider-delete-p1'));
    await waitFor(() => expect(screen.getByTestId('provider-delete-modal')).toBeTruthy());
    expect(screen.getByTestId('provider-delete-message').textContent).toMatch(/My-Provider/);
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('provider-delete-confirm'));
    await waitFor(() => expect(screen.queryByText('My-Provider')).toBeNull());
    confirmSpy.mockRestore();
  });

  it('blocks provider delete when models still exist', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '', enabled: true }];
        }
        if (method === 'provider.listModels') {
          return [{ id: 'm1', providerId: 'p1', modelId: 'gpt-x', name: 'Model X', enabled: true, createdAt: '' }];
        }
        if (method === 'provider.delete') return { ok: false, error: 'PROVIDER_HAS_MODELS' };
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-delete-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('provider-delete-p1'));
    fireEvent.click(screen.getByTestId('provider-delete-confirm'));
    await waitFor(() => expect(screen.getByTestId('provider-delete-error').textContent).toMatch(/模型/));
    expect(screen.getByText('My-Provider')).toBeTruthy();
  });

  it('toggles provider enabled from the list', async () => {
    let enabled = true;
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '', enabled }];
        }
        if (method === 'provider.listModels') return [];
        if (method === 'provider.setEnabled') {
          enabled = Boolean(args[1]);
          return { ok: true, provider: { id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '', enabled } };
        }
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-enabled-p1')).toBeTruthy());
    expect(screen.getByTestId('provider-enabled-p1').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('provider-enabled-p1'));
    await waitFor(() => expect(screen.getByTestId('provider-enabled-p1').getAttribute('aria-checked')).toBe('false'));
  });

  it('renders providers in a table with models/edit/delete icon actions', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' }];
        }
        if (method === 'provider.listModels' && args[0] === 'p1') {
          return [{ id: 'm1', providerId: 'p1', modelId: 'gpt-x', name: 'Model X', createdAt: '' }];
        }
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-table')).toBeTruthy());
    expect(screen.getByText('My-Provider')).toBeTruthy();
    expect(screen.getByTestId('provider-name-cell-p1').getAttribute('title')).toBe('My-Provider');
    expect(screen.getByTestId('provider-type-label-p1').textContent).toBe('OpenAI');
    expect(screen.getByTestId('provider-type-label-p1').getAttribute('title')).toBe('OpenAI');
    expect(screen.getByTestId('provider-models-cell-p1').textContent).toMatch(/Model X/);
    expect(screen.getByTestId('provider-models-cell-p1').getAttribute('title')).toMatch(/Model X/);
    expect(screen.getByTestId('provider-edit-models-p1')).toBeTruthy();
    expect(screen.getByTestId('provider-edit-p1')).toBeTruthy();
    expect(screen.getByTestId('provider-delete-p1')).toBeTruthy();
    expect(screen.queryByTestId('provider-models-p1')).toBeNull();
  });

  it('opens a models-only modal from the list action icon', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' }];
        }
        if (method === 'provider.listModels' && args[0] === 'p1') {
          return [{ id: 'm1', providerId: 'p1', modelId: 'gpt-x', name: 'Model X', contextTokens: 128_000, createdAt: '' }];
        }
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-edit-models-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('provider-edit-models-p1'));
    await waitFor(() => expect(screen.getByTestId('provider-models-modal')).toBeTruthy());
    expect(screen.getByTestId('provider-models-p1')).toBeTruthy();
    expect(screen.getByTestId('provider-models-table')).toBeTruthy();
    expect(screen.getByText('128K')).toBeTruthy();
    expect(screen.queryByTestId('provider-edit-form')).toBeNull();
    expect(screen.getAllByTestId(/^provider-model-add-row-/)).toHaveLength(1);
  });

  it('hides the models table in the edit modal when there are no models', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' }];
        }
        if (method === 'provider.listModels') return [];
        return [];
      },
    };
    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-edit-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('provider-edit-p1'));
    await waitFor(() => expect(screen.getByTestId('provider-models-p1')).toBeTruthy());
    expect(screen.queryByTestId('provider-models-table')).toBeNull();
    expect(screen.getAllByTestId(/^provider-model-add-row-/)).toHaveLength(1);
  });

  it('opens edit modal with form + models, and can add a model with context', async () => {
    const added: Array<{ args: unknown[] }> = [];
    let models = [
      { id: 'm1', providerId: 'p1', modelId: 'gpt-x', name: 'Model X', contextTokens: null as number | null, createdAt: '' },
    ];
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My-Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' }];
        }
        if (method === 'provider.listModels') {
          if (args[0] !== 'p1') return [];
          return models;
        }
        if (method === 'provider.addModel') {
          added.push({ args });
          const input = args[1] as { modelId: string; name: string; contextTokens?: number | null };
          const model = {
            id: 'm2',
            providerId: 'p1',
            modelId: input.modelId,
            name: input.name,
            contextTokens: input.contextTokens ?? null,
            createdAt: '',
          };
          models = [...models, model];
          return { ok: true, model };
        }
        if (method === 'provider.deleteModel') {
          models = models.filter((m) => m.id !== args[0]);
          return { ok: true };
        }
        return [];
      }
    };

    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('provider-edit-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('provider-edit-p1'));
    await waitFor(() => expect(screen.getByTestId('provider-edit-modal')).toBeTruthy());
    expect(screen.getByTestId('provider-edit-form')).toBeTruthy();
    expect((screen.getByTestId('provider-edit-name') as HTMLInputElement).value).toBe('My-Provider');
    expect(screen.getByTestId('provider-models-p1')).toBeTruthy();
    expect(screen.getByTestId('provider-models-table')).toBeTruthy();
    expect(screen.getByTestId('provider-model-delete-m1')).toBeTruthy();
    expect(screen.getAllByTestId(/^provider-model-add-row-/)).toHaveLength(1);

    fireEvent.click(screen.getByTestId('provider-model-add-open'));
    const draftRows = screen.getAllByTestId(/^provider-model-add-row-/);
    expect(draftRows).toHaveLength(2);
    const draftKey = draftRows[0]!.getAttribute('data-testid')!.replace('provider-model-add-row-', '');

    fireEvent.change(screen.getByTestId(`provider-model-id-${draftKey}`), { target: { value: 'gpt.y!' } });
    expect((screen.getByTestId(`provider-model-id-${draftKey}`) as HTMLInputElement).value).toBe('gpty');
    fireEvent.change(screen.getByTestId(`provider-model-id-${draftKey}`), { target: { value: 'gpt-y' } });
    fireEvent.change(screen.getByTestId(`provider-model-name-${draftKey}`), { target: { value: 'Model Y!' } });
    expect((screen.getByTestId(`provider-model-name-${draftKey}`) as HTMLInputElement).value).toBe('ModelY');
    fireEvent.change(screen.getByTestId(`provider-model-context-${draftKey}`), { target: { value: '128.5a' } });
    expect((screen.getByTestId(`provider-model-context-${draftKey}`) as HTMLInputElement).value).toBe('1285');
    fireEvent.change(screen.getByTestId(`provider-model-context-${draftKey}`), { target: { value: '128' } });
    fireEvent.click(screen.getByTestId(`provider-model-context-unit-${draftKey}-trigger`));
    fireEvent.click(screen.getByTestId(`provider-model-context-unit-${draftKey}-option-K`));
    fireEvent.click(screen.getByTestId(`provider-model-add-${draftKey}`));

    await waitFor(() => expect(screen.getByTestId('provider-model-m2')).toBeTruthy());
    expect(screen.getByTestId('provider-models-cell-p1').textContent).toMatch(/ModelY/);
    expect(screen.getByText('128K')).toBeTruthy();
    expect(added).toEqual([{ args: ['p1', { modelId: 'gpt-y', name: 'ModelY', contextTokens: 128_000 }] }]);
    expect(screen.queryByTestId(`provider-model-add-row-${draftKey}`)).toBeNull();
    expect(screen.getAllByTestId(/^provider-model-add-row-/)).toHaveLength(1);

    fireEvent.click(screen.getByTestId('provider-model-delete-m1'));
    await waitFor(() => expect(screen.getByTestId('provider-model-delete-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('provider-model-delete-confirm'));
    await waitFor(() => expect(screen.queryByTestId('provider-model-m1')).toBeNull());
    expect(screen.getByTestId('provider-model-m2')).toBeTruthy();
  });
});

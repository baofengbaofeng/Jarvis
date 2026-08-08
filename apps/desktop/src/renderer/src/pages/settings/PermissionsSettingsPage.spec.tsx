import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { PermissionsSettingsPage } from './PermissionsSettingsPage';
import { useAgentStore } from '../../stores/agent-store';
import { installMockJarvis } from '../../test/mockJarvis';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: getResources(),
    lng: 'zh-CN',
    ns: ['common'],
    defaultNS: 'common',
  });
});

beforeEach(() => {
  useAgentStore.setState({ agents: [], current: null });
});

afterEach(() => {
  cleanup();
});

describe('PermissionsSettingsPage', () => {
  const agent = { id: 'a1', name: 'Agent 1' };

  it('uses a field label distinct from option labels', async () => {
    installMockJarvis({
      invoke: async (m) => (m === 'agent.list' ? [agent] : []),
    });
    render(<PermissionsSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('perm-agent')).toBeTruthy());
    expect(screen.getByLabelText('沙箱级别')).toBeTruthy();
    expect(screen.getByLabelText('沙箱级别').tagName).toBe('SELECT');
  });

  it('saves the non-default readonly level via settingsSet', async () => {
    const jarvis = installMockJarvis({
      invoke: async (m) => (m === 'agent.list' ? [agent] : []),
      settingsGet: async () => undefined,
    });
    render(<PermissionsSettingsPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Agent 1' })).toBeTruthy());

    fireEvent.change(screen.getByTestId('perm-agent'), { target: { value: 'a1' } });
    fireEvent.change(screen.getByTestId('perm-level'), { target: { value: 'readonly' } });
    expect((screen.getByTestId('perm-level') as HTMLSelectElement).value).toBe('readonly');
    expect(screen.getByText('只读')).toBeTruthy();

    fireEvent.click(screen.getByTestId('perm-save'));
    await waitFor(() => {
      expect(jarvis.settingsSet).toHaveBeenCalledWith('permissions.a1', {
        level: 'readonly',
        allowCommands: [],
        allowDomains: [],
      });
    });
  });

  it('loads a saved system level when an agent is selected', async () => {
    installMockJarvis({
      invoke: async (m) => (m === 'agent.list' ? [agent] : []),
      settingsGet: async (key) =>
        key === 'permissions.a1'
          ? { level: 'system', allowCommands: [], allowDomains: [] }
          : undefined,
    });
    render(<PermissionsSettingsPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Agent 1' })).toBeTruthy());
    fireEvent.change(screen.getByTestId('perm-agent'), { target: { value: 'a1' } });
    await waitFor(() => {
      expect((screen.getByTestId('perm-level') as HTMLSelectElement).value).toBe('system');
    });
  });
});

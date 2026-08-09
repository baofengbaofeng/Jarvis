import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { SkillsSettingsPage } from './SkillsSettingsPage';

const invoke = vi.fn(async (channel: string) => {
  if (channel === 'skills.list') return [];
  if (channel === 'skills.importUrl') return { ok: true };
  return undefined;
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'en', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke,
    onDidReceive: () => () => {},
  };
});

afterEach(() => {
  cleanup();
  invoke.mockClear();
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'skills.list') return [];
    if (channel === 'skills.importUrl') return { ok: true };
    return undefined;
  });
});

describe('SkillsSettingsPage', () => {
  it('requires a URL before import', async () => {
    render(<SkillsSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('skills-import-url')).toBeTruthy());
    fireEvent.click(screen.getByTestId('skills-import-url'));
    await waitFor(() => expect(screen.getByTestId('skills-url-error')).toBeTruthy());
    expect(invoke).not.toHaveBeenCalledWith('skills.importUrl', expect.anything());
  });

  it('imports a skill from URL via IPC', async () => {
    render(<SkillsSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('skills-url-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('skills-url-input'), {
      target: { value: 'https://skills.example/SKILL.md' },
    });
    fireEvent.click(screen.getByTestId('skills-import-url'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('skills.importUrl', {
      url: 'https://skills.example/SKILL.md',
    }));
  });

  it('maps import errors to localized messages', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'skills.list') return [];
      if (channel === 'skills.importUrl') return { ok: false, error: 'SKILL_CONTENT_TYPE' };
      return undefined;
    });
    render(<SkillsSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('skills-url-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('skills-url-input'), {
      target: { value: 'https://skills.example/x' },
    });
    fireEvent.click(screen.getByTestId('skills-import-url'));
    await waitFor(() => expect(screen.getByTestId('skills-import-error').textContent).toContain('markdown'));
  });

  it('lists skills in a DataTable with delete modal', async () => {
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'skills.list') {
        return [{ id: 'sk1', name: 'Demo', path: '/tmp/Demo/SKILL.md', description: 'd', enabled: true }];
      }
      if (channel === 'skills.delete') return { ok: true };
      return undefined;
    });
    render(<SkillsSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('skill-sk1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('skill-delete-sk1'));
    await waitFor(() => expect(screen.getByTestId('skills-delete-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('skills-delete-confirm'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('skills.delete', 'sk1'));
  });
});

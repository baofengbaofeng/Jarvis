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
});

describe('SkillsSettingsPage', () => {
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
});

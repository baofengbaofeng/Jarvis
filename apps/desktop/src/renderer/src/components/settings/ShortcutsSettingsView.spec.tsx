import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DEFAULT_SHORTCUTS, type ShortcutAction } from '@jarvis/core/renderer';
import { ShortcutsSettingsView } from './ShortcutsSettingsView';

const invoke = vi.fn(async (m: string) => {
  if (m === 'shortcuts.get') return DEFAULT_SHORTCUTS;
  if (m === 'shortcuts.set') return DEFAULT_SHORTCUTS;
  return undefined;
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => {
  (window as any).jarvis = { invoke };
  invoke.mockClear();
});

afterEach(() => { cleanup(); });

describe('ShortcutsSettingsView', () => {
  it('loads shortcuts.get and renders a row per action', async () => {
    render(<ShortcutsSettingsView />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('shortcuts.get'));
    for (const a of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
      expect(screen.getByTestId(`record-${a}`)).toBeTruthy();
    }
  });

  it('saves the current bindings via shortcuts.set', async () => {
    render(<ShortcutsSettingsView />);
    await waitFor(() => expect(screen.getByTestId('shortcuts-save')).toBeTruthy());
    fireEvent.click(screen.getByTestId('shortcuts-save'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('shortcuts.set', DEFAULT_SHORTCUTS));
  });

  it('records a pressed key into the binding before saving', async () => {
    render(<ShortcutsSettingsView />);
    await waitFor(() => expect(screen.getByTestId('record-chat.send')).toBeTruthy());
    fireEvent.click(screen.getByTestId('record-chat.send'));
    fireEvent.keyDown(screen.getByTestId('capture-chat.send'), { key: 'j', metaKey: true });
    fireEvent.click(screen.getByTestId('shortcuts-save'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('shortcuts.set', expect.objectContaining({ 'chat.send': 'Cmd+J' })));
  });
});

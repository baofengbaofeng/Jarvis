import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DEFAULT_SHORTCUTS, type ShortcutAction } from '@jarvis/core/renderer';
import { useShortcuts } from './useShortcuts';

type Handlers = Partial<Record<ShortcutAction, () => void>>;

// C5 (M8 Task 7): the hook is mounted at the app root; this harness mounts it
// with spy handlers so the dispatch wiring (persisted binding → action) is
// asserted directly, independent of the real navigation/chat effects.
function Harness({ handlers }: { handlers: Handlers }) {
  useShortcuts(handlers);
  return <div>harness</div>;
}

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => {
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => (m === 'shortcuts.get' ? DEFAULT_SHORTCUTS : null),
    onDidReceive: () => () => {},
  };
});

afterEach(() => { cleanup(); });

describe('useShortcuts (C5)', () => {
  it('dispatches chat.new on Cmd+K', async () => {
    const spy = vi.fn();
    render(<Harness handlers={{ 'chat.new': spy }} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('dispatches settings.open on Cmd+,', async () => {
    const spy = vi.fn();
    render(<Harness handlers={{ 'settings.open': spy }} />);
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('dispatches task.cancel on Escape', async () => {
    const spy = vi.fn();
    render(<Harness handlers={{ 'task.cancel': spy }} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('dispatches focus.input on Cmd+L', async () => {
    const spy = vi.fn();
    render(<Harness handlers={{ 'focus.input': spy }} />);
    fireEvent.keyDown(window, { key: 'l', metaKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('dispatches chat.send on Cmd+Enter', async () => {
    const spy = vi.fn();
    render(<Harness handlers={{ 'chat.send': spy }} />);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('does not dispatch an unbound combo', async () => {
    const spy = vi.fn();
    render(<Harness handlers={{ 'chat.new': spy }} />);
    fireEvent.keyDown(window, { key: 'F9' });
    await new Promise(r => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
  });
});

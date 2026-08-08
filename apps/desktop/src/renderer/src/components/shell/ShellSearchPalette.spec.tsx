import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { PALETTE_LIST_LIMIT, ShellSearchPalette } from './ShellSearchPalette';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: getResources(),
    lng: 'en',
    ns: ['common'],
    defaultNS: 'common',
  });
});

afterEach(() => cleanup());

describe('ShellSearchPalette', () => {
  it('does not render when closed', () => {
    render(
      <ShellSearchPalette
        open={false}
        onClose={() => {}}
        agents={[]}
        sessions={[]}
        onSelectAgent={() => {}}
        onSelectChat={() => {}}
        onSelectAction={() => {}}
      />,
    );
    expect(screen.queryByTestId('shell-search-palette')).toBeNull();
  });

  it('opens as a floating palette with search input (not an inline sidebar field)', () => {
    render(
      <ShellSearchPalette
        open
        onClose={() => {}}
        agents={[{ id: 'a1', name: 'Helper', slug: 'helper' }]}
        sessions={[{ id: 's1', title: 'Hello' }]}
        onSelectAgent={() => {}}
        onSelectChat={() => {}}
        onSelectAction={() => {}}
      />,
    );
    expect(screen.getByTestId('shell-search-palette')).toBeTruthy();
    expect(screen.getByTestId('shell-palette-input')).toBeTruthy();
    expect(screen.getByTestId('shell-palette-item-agent-a1')).toBeTruthy();
    expect(screen.getByTestId('shell-palette-item-chat-s1')).toBeTruthy();
  });

  it('filters results and runs the selected action', () => {
    const onSelectAction = vi.fn();
    const onClose = vi.fn();
    render(
      <ShellSearchPalette
        open
        onClose={onClose}
        agents={[]}
        sessions={[]}
        onSelectAgent={() => {}}
        onSelectChat={() => {}}
        onSelectAction={onSelectAction}
      />,
    );
    fireEvent.change(screen.getByTestId('shell-palette-input'), { target: { value: 'settings' } });
    fireEvent.click(screen.getByTestId('shell-palette-item-action-settings'));
    expect(onSelectAction).toHaveBeenCalledWith('settings');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ShellSearchPalette
        open
        onClose={onClose}
        agents={[]}
        sessions={[]}
        onSelectAgent={() => {}}
        onSelectChat={() => {}}
        onSelectAction={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('caps idle agent/chat lists at 10 but searches the full set', () => {
    const agents = Array.from({ length: 15 }, (_, i) => ({
      id: `a${i}`,
      name: i === 14 ? 'UniqueZebra' : `Agent ${i}`,
      slug: `agent-${i}`,
    }));
    const sessions = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      title: i === 14 ? 'UniqueChat' : `Chat ${i}`,
    }));
    render(
      <ShellSearchPalette
        open
        onClose={() => {}}
        agents={agents}
        sessions={sessions}
        onSelectAgent={() => {}}
        onSelectChat={() => {}}
        onSelectAction={() => {}}
      />,
    );
    expect(screen.getAllByTestId(/^shell-palette-item-agent-/)).toHaveLength(PALETTE_LIST_LIMIT);
    expect(screen.getAllByTestId(/^shell-palette-item-chat-/)).toHaveLength(PALETTE_LIST_LIMIT);
    expect(screen.queryByTestId('shell-palette-item-agent-a14')).toBeNull();

    fireEvent.change(screen.getByTestId('shell-palette-input'), { target: { value: 'UniqueZebra' } });
    expect(screen.getByTestId('shell-palette-item-agent-a14')).toBeTruthy();

    fireEvent.change(screen.getByTestId('shell-palette-input'), { target: { value: 'UniqueChat' } });
    expect(screen.getByTestId('shell-palette-item-chat-s14')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { SelectionMenu } from './SelectionMenu';

// Same i18n bootstrap as the sibling component specs: init i18next with the
// real @jarvis/i18n resources so useTranslation('common') resolves and the
// component emits no NO_I18NEXT_INSTANCE warning under test.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

// vitest globals are off here, so @testing-library/react does not auto-cleanup
// between tests; two renders would pile up in the shared jsdom DOM and both
// components would answer the same data-testid query (each also has a live
// document mouseup listener). Unmount after every test.
afterEach(cleanup);

function mockSelection(anchor: Node) {
  window.getSelection = () => ({
    toString: () => 'hello',
    anchorNode: anchor,
    focusNode: anchor,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, right: 10 }) }),
  } as unknown as Selection);
}

describe('SelectionMenu', () => {
  it('invokes office.selection on action click inside a selection scope', async () => {
    const invoke = vi.fn(async () => ({ ok: true, result: '译文' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(
      <>
        <div data-selection-menu data-testid="scope">selectable</div>
        <SelectionMenu />
      </>,
    );
    mockSelection(screen.getByTestId('scope'));
    fireEvent.mouseUp(document);
    const btn = screen.getByTestId('sel-translate');
    fireEvent.click(btn);
    expect(invoke).toHaveBeenCalledWith('office.selection', expect.objectContaining({ action: 'translate' }));
  });

  it('does not open outside user-input / software-output scopes', () => {
    (window as unknown as { jarvis: unknown }).jarvis = { invoke: vi.fn(), onDidReceive: () => () => {} };
    render(
      <>
        <div data-testid="outside">nav label</div>
        <SelectionMenu />
      </>,
    );
    mockSelection(screen.getByTestId('outside'));
    fireEvent.mouseUp(document);
    expect(screen.queryByTestId('sel-translate')).toBeNull();
  });

  it('surfaces selection.error and closes the menu when the channel rejects', async () => {
    const invoke = vi.fn(async () => { throw new Error('no agent with a valid model binding'); });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(
      <>
        <div data-selection-menu data-testid="scope">selectable</div>
        <SelectionMenu />
      </>,
    );
    mockSelection(screen.getByTestId('scope'));
    fireEvent.mouseUp(document);
    fireEvent.click(screen.getByTestId('sel-translate'));
    // The error is surfaced via the wired selection.error key.
    expect(await screen.findByTestId('selection-error')).toBeTruthy();
    expect(screen.getByTestId('selection-error').textContent).toBe('处理失败');
    // setPos(null) runs in finally, so the floating menu must be dismissed.
    expect(screen.queryByTestId('sel-translate')).toBeNull();
  });
});

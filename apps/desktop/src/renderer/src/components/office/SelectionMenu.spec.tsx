import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionMenu } from './SelectionMenu';

describe('SelectionMenu', () => {
  it('invokes office.selection on action click', async () => {
    const invoke = vi.fn(async () => ({ ok: true, result: '译文' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<SelectionMenu />);
    // 直接触发组件内部逻辑:先模拟一次 selection
    // fireEvent.mouseUp (not a raw document.dispatchEvent) so the native event
    // is wrapped in act() — otherwise React 19 schedules the setPos flush on a
    // microtask and the menu button is not yet in the DOM when we query it.
    window.getSelection = () => ({ toString: () => 'hello', getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, right: 10 }) }) } as unknown as Selection);
    fireEvent.mouseUp(document);
    const btn = screen.getByTestId('sel-translate');
    fireEvent.click(btn);
    expect(invoke).toHaveBeenCalledWith('office.selection', expect.objectContaining({ action: 'translate' }));
  });
});

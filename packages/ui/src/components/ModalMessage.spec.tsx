import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModalMessage } from './ModalMessage';

const scrollHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (scrollHeightDesc) {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDesc);
  }
});

function mockLineMetrics(scrollHeight: number, lineHeightPx: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return scrollHeight;
    },
  });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    lineHeight: `${lineHeightPx}px`,
    fontSize: '14px',
  } as CSSStyleDeclaration);
}

describe('ModalMessage', () => {
  it('centers when content fits on one line', () => {
    mockLineMetrics(20, 21);
    render(<ModalMessage testId="msg">Short</ModalMessage>);
    const el = screen.getByTestId('msg');
    expect(el.getAttribute('data-align')).toBe('center');
    expect(el.className).toContain('jui-modal-message--center');
  });

  it('left-aligns when content wraps to multiple lines', () => {
    mockLineMetrics(48, 21);
    render(<ModalMessage testId="msg">Long wrapping copy</ModalMessage>);
    const el = screen.getByTestId('msg');
    expect(el.getAttribute('data-align')).toBe('start');
    expect(el.className).toContain('jui-modal-message--start');
  });
});

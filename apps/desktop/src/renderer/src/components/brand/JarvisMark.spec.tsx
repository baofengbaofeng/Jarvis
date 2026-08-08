import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { JarvisMark } from './JarvisMark';

afterEach(() => cleanup());

describe('JarvisMark', () => {
  it('renders lattice mark with default size', () => {
    render(<JarvisMark />);
    const el = screen.getByTestId('jarvis-mark');
    expect(el.getAttribute('data-variant')).toBe('mark');
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.getAttribute('style')).toMatch(/28px/);
  });

  it('supports app variant and lg size', () => {
    render(<JarvisMark variant="app" size="lg" />);
    const el = screen.getByTestId('jarvis-mark');
    expect(el.getAttribute('data-variant')).toBe('app');
    expect(el.getAttribute('style')).toMatch(/56px/);
  });
});

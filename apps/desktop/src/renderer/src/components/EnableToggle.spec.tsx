import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EnableToggle } from './EnableToggle';

afterEach(cleanup);

describe('EnableToggle', () => {
  it('toggles and exposes switch semantics', () => {
    const onChange = vi.fn();
    render(<EnableToggle enabled={false} onChange={onChange} testId="tog" aria-label="启用" />);
    const btn = screen.getByTestId('tog');
    expect(btn.getAttribute('aria-checked')).toBe('false');
    expect(btn.className).toContain('enable-toggle--off');
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

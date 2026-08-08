import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MenuSelect } from './MenuSelect';

afterEach(cleanup);

const opts = [
  { value: 'K', label: 'K' },
  { value: 'M', label: 'M' },
];

describe('MenuSelect', () => {
  it('opens a custom list and changes value without a native select', () => {
    const onChange = vi.fn();
    render(<MenuSelect value="K" options={opts} onChange={onChange} testId="unit" />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.querySelector('select')).toBeNull();
    fireEvent.click(screen.getByTestId('unit-trigger'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.click(screen.getByTestId('unit-option-M'));
    expect(onChange).toHaveBeenCalledWith('M');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

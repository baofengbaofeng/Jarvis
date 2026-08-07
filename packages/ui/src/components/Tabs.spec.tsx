import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  it('calls onChange when tab clicked', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]}
        active="a"
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FieldInput } from './FieldInput';

describe('FieldInput', () => {
  afterEach(() => cleanup());

  it('shows an in-box error and aria-invalid when error is set', () => {
    render(
      <FieldInput
        data-testid="sample"
        errorTestId="sample-error"
        error="Required"
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('sample-error').textContent).toBe('Required');
    expect(screen.getByTestId('sample').getAttribute('aria-invalid')).toBe('true');
  });

  it('omits error node when valid', () => {
    render(
      <FieldInput
        data-testid="sample"
        errorTestId="sample-error"
        value="ok"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('sample-error')).toBeNull();
    expect(screen.getByTestId('sample').getAttribute('aria-invalid')).toBe('false');
  });

  it('forwards onChange and maxLength', () => {
    let value = '';
    render(
      <FieldInput
        data-testid="sample"
        errorTestId="sample-error"
        maxLength={8}
        value={value}
        onChange={(e) => { value = e.target.value; }}
      />,
    );
    expect((screen.getByTestId('sample') as HTMLInputElement).maxLength).toBe(8);
    fireEvent.change(screen.getByTestId('sample'), { target: { value: 'abc' } });
    expect(value).toBe('abc');
  });
});

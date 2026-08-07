import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Composer } from './Composer';

describe('Composer', () => {
  it('submits via button click', () => {
    const onSubmit = vi.fn();
    render(
      <Composer value="hello" onChange={() => {}} onSubmit={onSubmit} sendTestId="send" />
    );
    fireEvent.click(screen.getByTestId('send'));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

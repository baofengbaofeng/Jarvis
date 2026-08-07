import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';

describe('MessageBubble', () => {
  it('applies role modifier class', () => {
    render(<MessageBubble role="user">Hi</MessageBubble>);
    expect(screen.getByText('Hi').closest('.jui-message--user')).toBeTruthy();
  });
});

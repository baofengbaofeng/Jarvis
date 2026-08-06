import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  it('applies elevated class when requested', () => {
    render(<Panel elevated data-testid="panel">Hi</Panel>);
    expect(screen.getByTestId('panel').className).toMatch(/jui-panel--elevated/);
  });
});

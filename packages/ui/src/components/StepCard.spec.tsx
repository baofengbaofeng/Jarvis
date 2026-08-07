import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepCard } from './StepCard';

describe('StepCard', () => {
  it('renders title and status dot', () => {
    render(<StepCard title="Run tool" status="running" />);
    expect(screen.getByText('Run tool')).toBeTruthy();
    expect(document.querySelector('.jui-stepcard__dot--running')).toBeTruthy();
  });
});

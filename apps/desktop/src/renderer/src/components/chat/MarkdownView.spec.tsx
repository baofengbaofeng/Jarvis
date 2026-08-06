import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';

describe('MarkdownView', () => {
  it('renders only https links as external anchors', () => {
    const { container, rerender } = render(<MarkdownView content="[safe](https://example.com)" />);
    expect(container.querySelector('a')).toMatchObject({ target: '_blank', rel: 'noreferrer noopener' });
    rerender(<MarkdownView content="[bad](file:///etc/passwd)" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('bad');
    rerender(<MarkdownView content="[rel](/path)" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('rel');
  });
});

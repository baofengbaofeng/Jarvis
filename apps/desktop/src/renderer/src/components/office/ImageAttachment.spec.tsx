import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ImageAttachment } from './ImageAttachment';

// No i18n init needed — ImageAttachment renders no strings (the × is a literal
// glyph). vitest globals are off, so @testing-library/react does not
// auto-cleanup; unmount after every test like the sibling component specs.
afterEach(cleanup);

describe('ImageAttachment', () => {
  it('renders an img preview for a data URL and calls onRemove with the src', () => {
    const onRemove = vi.fn();
    const src = 'data:image/png;base64,AAA';
    render(<ImageAttachment src={src} onRemove={onRemove} />);
    const root = screen.getByTestId('image-attachment');
    expect(root).toBeTruthy();
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(src);
    fireEvent.click(screen.getByTestId('image-attachment-remove'));
    expect(onRemove).toHaveBeenCalledWith(src);
  });

  it('renders nothing for non-image content', () => {
    const { container } = render(<ImageAttachment src="plain text" onRemove={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

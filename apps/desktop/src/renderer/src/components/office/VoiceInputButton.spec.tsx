import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VoiceInputButton } from './VoiceInputButton';

// No i18n init needed here — VoiceInputButton has no user-facing strings (emoji
// glyphs only). vitest globals are off, so @testing-library/react does not
// auto-cleanup between tests; unmount after every test like the sibling specs.
afterEach(cleanup);

describe('VoiceInputButton', () => {
  it('no-ops when Web Speech is unavailable', () => {
    const onText = vi.fn();
    render(<VoiceInputButton onText={onText} />);
    fireEvent.mouseDown(screen.getByTestId('voice-input'));
    expect(onText).not.toHaveBeenCalled();
  });
});

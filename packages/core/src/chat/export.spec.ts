import { describe, it, expect } from 'vitest';
import { exportSessionMarkdown } from './export';

describe('exportSessionMarkdown', () => {
  it('formats messages', () => {
    const md = exportSessionMarkdown([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello **world**' }
    ]);
    expect(md).toContain('**user**\n\nHi');
    expect(md).toContain('**assistant**\n\nHello **world**');
  });
});

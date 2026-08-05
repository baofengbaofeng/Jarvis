import { describe, it, expect } from 'vitest';
import { listTemplateVars, substituteTemplate } from './templates';

describe('templates', () => {
  it('lists variables', () => {
    expect(listTemplateVars('Hi {{name}}, task {{ name }} done')).toEqual(['name']);
  });

  it('substitutes variables', () => {
    expect(substituteTemplate('Hi {{name}}', { name: 'Jarvis' })).toBe('Hi Jarvis');
    expect(substituteTemplate('No vars', {})).toBe('No vars');
  });
});

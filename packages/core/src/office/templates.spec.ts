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

  it('does not leak prototype keys as variables', () => {
    // \w+ matches identifiers like constructor/toString/__proto__, but an
    // unbound var must render empty — NOT Object.prototype's built-in values.
    expect(substituteTemplate('{{constructor}} {{name}}', { name: 'x' })).toBe(' x');
    expect(substituteTemplate('{{toString}}', {})).toBe('');
    expect(substituteTemplate('{{__proto__}}', {})).toBe('');
  });
});

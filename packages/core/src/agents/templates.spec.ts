import { describe, it, expect } from 'vitest';
import { seedTemplates } from './templates';

// L30 (M8 Task 8): agent template library seed. Four presets across the four
// categories; ids unique; no hardcoded model names (Q4 forbids them — templates
// carry no modelId, the create-from-template flow always creates with
// modelId: null and lets the user pick a model later).
describe('seedTemplates', () => {
  it('provides office, coding, review and generic presets with unique ids', () => {
    const ts = seedTemplates();
    expect(ts.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ts.map(t => t.id)).size).toBe(ts.length);
    expect(ts.map(t => t.category)).toEqual(expect.arrayContaining(['office', 'coding', 'review', 'generic']));
  });

  it('contains no hardcoded model names', () => {
    expect(JSON.stringify(seedTemplates()).toLowerCase()).not.toMatch(/gpt-4|claude-3|llama|gemini/);
  });

  it('keeps defaultSkills aligned with the M3 tool registry names', () => {
    const coding = seedTemplates().find(t => t.id === 'tpl-coding');
    expect(coding?.defaultSkills).toContain('read_file');
    expect(coding?.defaultSkills).toContain('write_file');
    expect(coding?.defaultSkills).toContain('run_shell');
  });
});

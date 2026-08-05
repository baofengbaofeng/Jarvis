// L30 (M8 Task 8): agent template library seed.
//
// Templates are pure data — no modelId (Q4 forbids hardcoding model names; the
// create-from-template flow always creates with modelId: null and lets the user
// pick a model later). `defaultSkills` is informational/documentation: skills
// are global + filesystem-injected (not per-agent), so AgentInput has no skills
// field and creation never passes one. Tool names match the M3 ToolRegistry
// registrations (read_file / write_file / run_shell).
export type TemplateCategory = 'office' | 'coding' | 'review' | 'generic';

export interface AgentTemplate {
  id: string;
  nameKey: string;
  icon: string;
  descriptionKey: string;
  category: TemplateCategory;
  systemPrompt: string;
  defaultSkills: string[];
}

export function seedTemplates(): AgentTemplate[] {
  return [
    {
      id: 'tpl-office', nameKey: 'templates.office.name', icon: '📝', descriptionKey: 'templates.office.desc', category: 'office',
      systemPrompt: '你是办公助手。负责起草邮件、报告、文案，输出正式得体的中文。', defaultSkills: []
    },
    {
      id: 'tpl-coding', nameKey: 'templates.coding.name', icon: '💻', descriptionKey: 'templates.coding.desc', category: 'coding',
      systemPrompt: '你是编程 Agent。遵循 REPL 循环：分析需求→读取相关文件→修改→运行测试→修正，直到通过。',
      defaultSkills: ['read_file', 'write_file', 'run_shell']
    },
    {
      id: 'tpl-review', nameKey: 'templates.review.name', icon: '🔍', descriptionKey: 'templates.review.desc', category: 'review',
      systemPrompt: '你是代码审查 Agent。只读分析，输出问题清单与修改建议，不直接改文件。', defaultSkills: ['read_file']
    },
    {
      id: 'tpl-generic', nameKey: 'templates.generic.name', icon: '🤖', descriptionKey: 'templates.generic.desc', category: 'generic',
      systemPrompt: '你是一位通用助手，根据用户指令完成任务。', defaultSkills: []
    }
  ];
}

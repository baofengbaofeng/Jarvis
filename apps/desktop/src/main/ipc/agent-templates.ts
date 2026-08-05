import { seedTemplates } from '@jarvis/core';

// L30 (M8 Task 8): agent template library IPC.
//
// IMPORTANT: channel prefix is `agent-templates.*`, NOT `templates.*` — the D15
// prompt-template store owns `templates.list/create/update/delete/render` in
// IpcRouter, and reusing those names would overwrite D15's registrations.
//
// `createAgent` is injected (threaded from the real `createAgentStore(db).create`
// in IpcRouter). `defaultSkills` is informational/documentation — skills are
// global + filesystem-injected (not per-agent), so AgentInput has no skills
// field and creation never passes one.
export interface AgentTemplateCreateInput {
  templateId: string;
  name: string;
  workspaceId?: string;
}

export function createAgentTemplatesIpc(createAgent: (input: { name: string; systemPrompt: string; workspaceId: string | null }) => { id: string } | Promise<{ id: string }>) {
  const list = () => seedTemplates();
  const createAgentFromTemplate = async (_e: unknown, input: AgentTemplateCreateInput): Promise<{ id: string }> => {
    const tpl = seedTemplates().find(t => t.id === input.templateId);
    if (!tpl) throw new Error(`unknown template: ${input.templateId}`);
    // The template carries no modelId (Q4 — no hardcoded model names); the
    // injected createAgent resolves modelId: null and lets the user pick later.
    return createAgent({ name: input.name, systemPrompt: tpl.systemPrompt, workspaceId: input.workspaceId ?? null });
  };
  return { list, createAgent: createAgentFromTemplate };
}

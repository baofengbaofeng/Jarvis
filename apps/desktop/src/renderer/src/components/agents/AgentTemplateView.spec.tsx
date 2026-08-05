import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import type { AgentTemplate } from '@jarvis/core/renderer';
import { AgentTemplateView } from './AgentTemplateView';

const templates: AgentTemplate[] = [
  { id: 'tpl-office', nameKey: 'templates.office.name', icon: '📝', descriptionKey: 'templates.office.desc', category: 'office', systemPrompt: '你是办公助手。', defaultSkills: [] },
  { id: 'tpl-coding', nameKey: 'templates.coding.name', icon: '💻', descriptionKey: 'templates.coding.desc', category: 'coding', systemPrompt: '你是编程 Agent。', defaultSkills: ['read_file', 'write_file', 'run_shell'] }
];

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'agent-templates.list' ? templates : [],
    onDidReceive: () => () => {}
  };
});

afterEach(() => { cleanup(); });

describe('AgentTemplateView', () => {
  it('renders template cards from agent-templates.list with translated labels', async () => {
    render(<AgentTemplateView onCreate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('template-card')).toHaveLength(2));
    // The zh-CN label is rendered, not the raw i18n key string.
    expect(screen.getByTestId('template-name-tpl-office').textContent).toBe('办公写作');
    expect(screen.getByTestId('template-name-tpl-coding').textContent).toBe('编程 Agent');
    expect(screen.getByTestId('template-desc-tpl-office').textContent).toBe('起草邮件、报告与文案的办公助手');
  });

  it('invokes onCreate with the template and the typed name', async () => {
    const onCreate = vi.fn();
    render(<AgentTemplateView onCreate={onCreate} />);
    await waitFor(() => expect(screen.getByTestId('create-tpl-office')).toBeTruthy());
    fireEvent.change(screen.getByTestId('name-tpl-office'), { target: { value: '我的 Agent' } });
    fireEvent.click(screen.getByTestId('create-tpl-office'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(templates[0], '我的 Agent');
  });

  it('renders defaultSkills as informational chips for the coding template', async () => {
    render(<AgentTemplateView onCreate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('template-skills-tpl-coding').textContent).toContain('read_file'));
  });
});

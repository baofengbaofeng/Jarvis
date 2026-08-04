import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { AgentListView } from './AgentListView';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'agent.list' ? [{ id: 'a1', name: 'Coder', slug: 'coder', description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }] : [],
    onDidReceive: () => () => {}
  };
});

describe('AgentListView', () => {
  it('lists agents', async () => {
    render(<AgentListView />);
    await waitFor(() => expect(screen.getByText('Coder')).toBeTruthy());
  });
});

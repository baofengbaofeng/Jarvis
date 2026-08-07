import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { OnboardingPage } from './OnboardingPage';

vi.hoisted(() => {
  window.jarvis = {
    invoke: vi.fn(async (m: string) => {
      if (m === 'provider.create') return { id: 'p1' };
      if (m === 'agent.create') return { id: 'a1', name: 'Test', slug: 'test' };
      if (m === 'diagnostics.run') return { items: [{ id: 'node', ok: true, detail: 'ok' }] };
      return null;
    }),
    settingsGet: vi.fn(),
    settingsSet: vi.fn().mockResolvedValue(undefined),
    onDidReceive: vi.fn()
  } as unknown as Window['jarvis'];
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('OnboardingPage', () => {
  it('starts at step 1 and completes', async () => {
    let done = false;
    render(
      <MemoryRouter>
        <OnboardingPage onDone={() => { done = true; }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('onboarding-step-1')).toBeTruthy();
    const step1Inputs = screen.getAllByRole('textbox');
    fireEvent.change(step1Inputs[0]!, { target: { value: 'OpenAI' } });
    fireEvent.change(step1Inputs[1]!, { target: { value: 'https://api.example.com' } });
    fireEvent.click(screen.getByTestId('onboarding-next'));
    await waitFor(() => expect(screen.getByTestId('onboarding-step-2')).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Assistant' } });
    fireEvent.click(screen.getByTestId('onboarding-next'));
    await waitFor(() => expect(screen.getByTestId('onboarding-step-3')).toBeTruthy());
    fireEvent.click(screen.getByTestId('onboarding-finish'));
    await waitFor(() => expect(done).toBe(true));
  });
});

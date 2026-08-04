import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { OnboardingPage } from './OnboardingPage';

// The default settings store (Task 8) reads window.jarvis at module load time
// (createSettingsStore(window.jarvis)), which happens when OnboardingPage is
// imported. A beforeAll hook runs too late — the store would capture undefined.
// vi.hoisted executes before the imports evaluate, so the bridge is defined
// when the store is created. (Test-only; production code is untouched.)
vi.hoisted(() => {
  window.jarvis = {
    invoke: vi.fn(),
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
    fireEvent.click(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-step-2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('onboarding-next'));
    fireEvent.click(screen.getByTestId('onboarding-finish'));
    // finish() awaits setOnboardingDone(true) before onDone(), so completion is
    // async; wait for the bridge promise to settle.
    await waitFor(() => expect(done).toBe(true));
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModeIndicator, type RuntimeMode } from './ModeIndicator';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';

describe('ModeIndicator (L39)', () => {
  beforeEach(() => {
    i18n.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { common: { runtime: { mode: { local: '本地模式', runtime_registered: 'Runtime 已注册', runtime_busy: 'Runtime 忙碌' } } } } } });
  });
  // it.each renders per case into document.body; without cleanup the second
  // case finds the first case's node (vitest globals are off, so no auto).
  afterEach(cleanup);
  it.each<RuntimeMode>(['local', 'runtime_registered', 'runtime_busy'])('renders mode %s', (mode) => {
    render(<I18nextProvider i18n={i18n}><ModeIndicator mode={mode} /></I18nextProvider>);
    expect(screen.getByTestId('mode-indicator')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { CanvasView } from './CanvasView';

beforeAll(async () => {
  // Same i18n init as sibling specs (VersionHistoryPage.spec) so useTranslation
  // resolves the canvas.* keys without noise.
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('CanvasView', () => {
  const tableArtifact = {
    id: 't1-t1', taskId: 't1', kind: 'table', content: '| A | B |\n|---|---|\n| 1 | 2 |'
  };

  function mockJarvis(returnValue: unknown) {
    const invoke = vi.fn(async (channel: string) => (channel === 'artifacts.list' ? returnValue : []));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    return invoke;
  }

  it('renders table cells from a table artifact loaded via artifacts.list', async () => {
    const invoke = mockJarvis([tableArtifact]);
    render(<CanvasView taskId="t1" />);
    expect(await screen.findByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('artifacts.list', 't1');
  });

  it('shows the empty state when artifacts.list returns no artifacts', async () => {
    mockJarvis([]);
    render(<CanvasView taskId="t1" />);
    expect(await screen.findByTestId('canvas-empty')).toBeTruthy();
    // The i18n label (not the raw no_artifacts literal) is shown.
    expect(screen.getByText('暂无任务产物')).toBeTruthy();
  });

  it('does not invoke artifacts.list when taskId is absent and shows the empty state', () => {
    const invoke = mockJarvis([]);
    render(<CanvasView />);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('canvas-empty')).toBeTruthy();
  });

  it('renders mermaid and chart artifacts as JSON previews', async () => {
    mockJarvis([
      { id: 't1-m1', taskId: 't1', kind: 'mermaid', content: 'graph TD; A-->B' },
      { id: 't1-c1', taskId: 't1', kind: 'chart', content: '[{"label":"a","value":1}]' }
    ]);
    render(<CanvasView taskId="t1" />);
    expect((await screen.findByTestId('artifact-mermaid')).textContent).toContain('graph TD; A-->B');
    expect(screen.getByTestId('artifact-chart').textContent).toContain('[{"label":"a","value":1}]');
  });
});

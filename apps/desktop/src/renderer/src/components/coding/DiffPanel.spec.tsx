import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DiffPanel } from './DiffPanel';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('DiffPanel', () => {
  it('shows hunks and commits accepts', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<DiffPanel taskId="t1" path="a.ts" base={'const x = 1;\n' + 'y'} modified={'const x = 2;\n' + 'y'} />);
    expect(screen.getByTestId('hunk-0')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hunk-0-accept'));
    fireEvent.click(screen.getByTestId('diff-commit'));
    expect(invoke).toHaveBeenCalledWith('diff.applyAll', { taskId: 't1', path: 'a.ts', accepts: [true] });
  });

  it('resets decisions when the diff changes so undecided hunks are not silently committed', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    const { rerender } = render(
      <DiffPanel taskId="t1" path="a.ts" base={'const x = 1;\nconst y = 2;'} modified={'const x = 2;\nconst y = 2;'} />
    );
    // Decide the only hunk on a.ts -> Apply appears.
    fireEvent.click(screen.getByTestId('hunk-0-accept'));
    expect(screen.getByTestId('diff-commit')).toBeTruthy();
    // Same mounted instance re-rendered with a different file: decisions must
    // reset so Apply stays hidden until the new hunks are decided. Without the
    // reset, allDone would still be true and Apply would show with a stale,
    // shorter accepts array (which the main-side guard then rejects).
    rerender(
      <DiffPanel taskId="t1" path="b.ts" base={'const a = 1;\nconst b = 2;'} modified={'const a = 1;\nconst b = 3;'} />
    );
    await waitFor(() => expect(screen.queryByTestId('diff-commit')).toBeNull());
  });
});

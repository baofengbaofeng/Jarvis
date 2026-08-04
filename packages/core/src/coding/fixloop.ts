export interface TestRunResult { pass: boolean; output: string }
export interface FixLoopDeps {
  runTests(): Promise<TestRunResult>;
  pullDiagnostics(): Promise<string[]>;
  runEngine(feedback: string): Promise<string>;
}
export interface FixLoopResult { passed: boolean; attempts: number }
export interface FixLoopOpts { maxRetries?: number; onAttempt?: (attempt: number) => void }

export async function runTestFixLoop(deps: FixLoopDeps, opts: FixLoopOpts = {}): Promise<FixLoopResult> {
  const max = opts.maxRetries ?? 3;
  for (let attempt = 0; attempt <= max; attempt++) {
    opts.onAttempt?.(attempt);
    const t = await deps.runTests();
    if (t.pass) return { passed: true, attempts: attempt };
    if (attempt === max) return { passed: false, attempts: attempt + 1 };
    const diags = await deps.pullDiagnostics();
    const feedback = `Test failed (attempt ${attempt + 1}):\n${t.output}${diags.length ? '\nDiagnostics:\n' + diags.join('\n') : ''}`;
    await deps.runEngine(feedback);
  }
  return { passed: false, attempts: max + 1 };
}

export type ApprovalDecision = 'allow' | 'deny' | 'ask';

export interface ApprovalRuleSet { allowAlways: string[]; sensitiveCommands?: RegExp[] }

// Sensitive patterns force deny (no prompt) for destructive shell sequences.
const DEFAULT_SENSITIVE = [
  /\brm\b[^|;]*-[a-z]*[rf]/,
  /sudo\s/,
  /[:;]\s*rm/,
  /mkfs/,
  /dd\s+of=/,
  /\|\s*(sh|bash|zsh)\b/,
  /curl[^|]*\|/,
];

/** Tools that mutate state or leave the sandbox — always prompt unless allowAlways. */
const DEFAULT_ASK = new Set([
  'write_file',
  'run_shell',
  'git_add',
  'git_commit',
  'run_tests',
  'web_search',
  'memorize',
  'delegate_agent',
]);

export function createApprovalGate() {
  return {
    evaluate(toolName: string, args: Record<string, unknown>, rules: ApprovalRuleSet): ApprovalDecision {
      if (rules.allowAlways.includes(toolName)) return 'allow';
      if (toolName.startsWith('mcp:') || toolName.startsWith('plugin:')) return 'ask';

      const haystack = Object.values(args).filter((v): v is string => typeof v === 'string').join('\n');
      const command = String(args.command ?? '');
      const text = `${command}\n${haystack}`;
      if (DEFAULT_SENSITIVE.some(rx => rx.test(text)) || (rules.sensitiveCommands ?? []).some(rx => rx.test(text))) {
        return 'deny';
      }

      if (DEFAULT_ASK.has(toolName) || toolName.startsWith('git_')) return 'ask';
      // Unknown tools must be reviewed rather than silently allowed.
      return 'ask';
    }
  };
}

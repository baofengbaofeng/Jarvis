export type ApprovalDecision = 'allow' | 'deny' | 'ask';
export type ToolSensitivity = 'safe' | 'ask' | 'deny';

export interface ApprovalRuleSet { allowAlways: string[]; sensitiveCommands?: RegExp[] }

export interface ApprovalEvaluateMeta {
  /** Declared on ToolDef — preferred over hardcoded name sets. */
  sensitivity?: ToolSensitivity;
}

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

/** Fallback ask set when ToolDef.sensitivity is absent (legacy tools). */
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

/** Deep-collect every string leaf so nested args cannot hide sensitive commands. */
export function collectStringArgs(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringArgs(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStringArgs(v, out);
  }
  return out;
}

export function createApprovalGate() {
  return {
    evaluate(
      toolName: string,
      args: Record<string, unknown>,
      rules: ApprovalRuleSet,
      meta: ApprovalEvaluateMeta = {},
    ): ApprovalDecision {
      if (rules.allowAlways.includes(toolName)) return 'allow';
      if (toolName.startsWith('mcp:') || toolName.startsWith('plugin:')) return 'ask';

      const text = collectStringArgs(args).join('\n');
      if (DEFAULT_SENSITIVE.some(rx => rx.test(text)) || (rules.sensitiveCommands ?? []).some(rx => rx.test(text))) {
        return 'deny';
      }

      const sensitivity = meta.sensitivity;
      if (sensitivity === 'deny') return 'deny';
      if (sensitivity === 'safe') return 'allow';
      if (sensitivity === 'ask') return 'ask';

      if (DEFAULT_ASK.has(toolName) || toolName.startsWith('git_')) return 'ask';
      // Unknown tools must be reviewed rather than silently allowed.
      return 'ask';
    }
  };
}

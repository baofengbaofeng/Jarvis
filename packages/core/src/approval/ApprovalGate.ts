export type ApprovalDecision = 'allow' | 'deny';

export interface ApprovalRuleSet { allowAlways: string[]; sensitiveCommands?: RegExp[] }

// NOTE 1: the brief's `/ : / \s* rm /` was a syntax error (a regex literal
// followed by stray `\s*rm/`); fixed to `/[:;]\s*rm/` which matches the
// intended `; rm` / `: rm` shell-sequence pattern.
// NOTE 2: `sensitiveCommands` is optional so the brief's spec (which passes
// only `{ allowAlways }`) type-checks against the interface.
const DEFAULT_SENSITIVE = [/rm\s+-rf/, /sudo\s/, /[:;]\s*rm/, /mkfs/, /dd\s+of=/];

export function createApprovalGate() {
  return {
    evaluate(toolName: string, args: Record<string, unknown>, rules: ApprovalRuleSet): ApprovalDecision {
      if (rules.allowAlways.includes(toolName)) return 'allow';
      if (toolName.startsWith('mcp:')) return 'deny'; // 首次调用需审批,批准后进入 allowAlways
      const command = String(args.command ?? '');
      if (DEFAULT_SENSITIVE.some(rx => rx.test(command)) || (rules.sensitiveCommands ?? []).some(rx => rx.test(command))) return 'deny';
      return 'allow';
    }
  };
}

import { useTranslation } from 'react-i18next';
import { useApprovalStore } from '../../stores/approval-store';

// J2 (M3 final review): renders the pending interactive-approval request sent
// by the main process ApprovalCenter. Approve/Deny route through
// window.jarvis.invoke('approval.resolve', id, ok), which unblocks the task.
export function ApprovalModal() {
  const { t } = useTranslation('common');
  const pending = useApprovalStore((s) => s.pending);
  const resolve = useApprovalStore((s) => s.resolve);
  if (pending.length === 0) return null;
  const req = pending[0];
  return (
    <div className="approval-backdrop" data-testid="approval-modal" role="dialog" aria-modal="true">
      <div className="approval-card">
        <h3 data-testid="approval-tool">{req.toolName}</h3>
        <p data-testid="approval-prompt">{req.prompt}</p>
        <pre data-testid="approval-args">{JSON.stringify(req.args, null, 2)}</pre>
        <div className="approval-actions">
          <button data-testid="approval-approve" onClick={() => void resolve(req.id, true)}>{t('approval.approve')}</button>
          <button data-testid="approval-deny" onClick={() => void resolve(req.id, false)}>{t('approval.deny')}</button>
        </div>
      </div>
    </div>
  );
}

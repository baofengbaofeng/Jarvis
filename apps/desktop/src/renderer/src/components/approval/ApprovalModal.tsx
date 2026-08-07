import { useTranslation } from 'react-i18next';
import { Button, Modal } from '@jarvis/ui';
import { useApprovalStore } from '../../stores/approval-store';

export function ApprovalModal() {
  const { t } = useTranslation('common');
  const pending = useApprovalStore((s) => s.pending);
  const resolve = useApprovalStore((s) => s.resolve);
  if (pending.length === 0) return null;
  const req = pending[0];
  return (
    <Modal
      open
      testId="approval-modal"
      title={<span data-testid="approval-tool">{req.toolName}</span>}
      actions={
        <>
          <Button variant="primary" data-testid="approval-approve" onClick={() => void resolve(req.id, true)}>
            {t('approval.approve')}
          </Button>
          <Button variant="danger" data-testid="approval-deny" onClick={() => void resolve(req.id, false)}>
            {t('approval.deny')}
          </Button>
        </>
      }
    >
      <p data-testid="approval-prompt">{req.prompt}</p>
      <pre data-testid="approval-args">{JSON.stringify(req.args, null, 2)}</pre>
    </Modal>
  );
}

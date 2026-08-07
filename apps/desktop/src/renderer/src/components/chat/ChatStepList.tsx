import { StepCard } from '@jarvis/ui';
import { useChatStore } from '../../stores/chat-store';

export function ChatStepList() {
  const steps = useChatStore((s) => s.steps);
  if (steps.length === 0) return null;
  return (
    <div data-testid="chat-steps" className="chat-steps">
      {steps.map((step) => (
        <StepCard
          key={step.id}
          title={step.title}
          status={step.status}
          defaultOpen={step.status === 'error'}
        >
          {step.detail ? <pre>{step.detail}</pre> : null}
        </StepCard>
      ))}
    </div>
  );
}

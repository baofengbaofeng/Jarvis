import './Toast.css';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export type ToastProps = {
  message: string;
  kind?: ToastKind;
  testId?: string;
};

export function Toast({ message, kind = 'info', testId }: ToastProps) {
  return (
    <div
      className={`jui-toast jui-toast--${kind}`}
      data-testid={testId}
      role="status"
    >
      {message}
    </div>
  );
}

export type ToastHostProps = {
  children: React.ReactNode;
};

export function ToastHost({ children }: ToastHostProps) {
  return (
    <div className="jui-toast-host" data-testid="toast-host">
      {children}
    </div>
  );
}

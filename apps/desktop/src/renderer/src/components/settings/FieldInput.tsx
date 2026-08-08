import type { InputHTMLAttributes } from 'react';
import { Input } from '@jarvis/ui';

export type FieldInputProps = {
  error?: string;
  errorTestId: string;
  placeholder?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'>;

/** Value + in-box validation error (help text stays outside under the label). */
export function FieldInput({
  error,
  errorTestId,
  placeholder,
  ...inputProps
}: FieldInputProps) {
  const invalid = Boolean(error);
  return (
    <div
      className={['form-input-shell', invalid ? 'form-input-shell--invalid' : ''].filter(Boolean).join(' ')}
    >
      <Input
        {...inputProps}
        placeholder={placeholder}
        aria-invalid={invalid}
        className="form-input-shell__input"
      />
      {error ? (
        <p data-testid={errorTestId} role="alert" className="form-input-shell__error">{error}</p>
      ) : null}
    </div>
  );
}

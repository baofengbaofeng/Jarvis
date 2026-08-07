import type { InputHTMLAttributes } from 'react';
import './SearchInput.css';

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  onClear?: () => void;
};

export function SearchInput({ className, value, onClear, ...rest }: SearchInputProps) {
  const classes = ['jui-search-input', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <span className="jui-search-input__icon" aria-hidden>⌕</span>
      <input type="search" className="jui-search-input__field" value={value} {...rest} />
      {onClear != null && value != null && String(value).length > 0 && (
        <button type="button" className="jui-search-input__clear" aria-label="Clear" onClick={onClear}>×</button>
      )}
    </div>
  );
}

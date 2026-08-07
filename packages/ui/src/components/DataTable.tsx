import type { ReactNode } from 'react';
import './DataTable.css';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  className?: string;
};

export function DataTable<T>({ columns, rows, rowKey, empty, className }: DataTableProps<T>) {
  const classes = ['jui-data-table', className].filter(Boolean).join(' ');
  if (rows.length === 0 && empty != null) return <div className={classes}>{empty}</div>;
  return (
    <div className={classes}>
      <table>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} className={col.className}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(col => (
                <td key={col.key} className={col.className}>
                  {col.render != null ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

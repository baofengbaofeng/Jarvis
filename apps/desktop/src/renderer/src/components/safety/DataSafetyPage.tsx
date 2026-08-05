import { BackupPane } from './BackupPane';

// L18 (M8 Task 4): data safety page. Single-tab (backup) for this task; Task 5
// extends this page with the wipe tab.
export function DataSafetyPage() {
  return (
    <div data-testid="data-safety-page">
      <BackupPane />
    </div>
  );
}

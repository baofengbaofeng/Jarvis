import { Outlet } from 'react-router-dom';

/** Settings content pane — nav lives in the app sidebar (Cursor-style overlay). */
export function SettingsLayout() {
  return (
    <div data-testid="settings-layout" className="settings-layout">
      <main className="settings-layout__main">
        <Outlet />
      </main>
    </div>
  );
}

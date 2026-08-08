# Settings main area + future right pane

## Current layout

- Shell: sidebar | main (`1fr` fills remaining width)
- In settings: the **entire** main area (topbar / content / footer) uses `--settings-bg` gray
- Settings content column: **800px**, horizontally centered inside that gray area

## Future right push panel

- `AppShell` accepts optional `rightPane`; only then does a third column appear (`jui-appshell--with-right`)
- Resize handle between main and right can be wired when a panel is mounted (`useMainPaneChrome` kept for that)

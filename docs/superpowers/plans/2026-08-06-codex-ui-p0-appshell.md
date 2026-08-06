# Codex UI P0：`packages/ui` + AppShell 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `@jarvis/ui` 设计令牌与壳层 primitives，并在桌面端接入统一 AppShell（左导航 + 顶栏 + Outlet），默认浅色主题，使全路由可在壳内导航。

**Architecture:** 纯展示包 `@jarvis/ui`（CSS 变量令牌 + React 组件，零业务依赖）被 desktop renderer 消费。`AppLayout` 用 `react-router` 的 `NavLink`/`Outlet` 接线；Onboarding 留在壳外。本阶段不引入 Tailwind（YAGNI）；组件用独立 CSS + 令牌变量。P1+ 再做 Chat Composer/StepCard 精修。

**Tech Stack:** React 19、TypeScript、CSS 变量、vitest + @testing-library/react + jsdom、react-router-dom、react-i18next、zustand（仅 desktop theme-store）、pnpm workspaces。

**Spec:** `docs/superpowers/specs/2026-08-06-codex-ui-design-system.md`（P0 范围）。

## Global Constraints

- `packages/ui` **不得**依赖 `@jarvis/core`、Electron、IPC、zustand；本阶段也**移除**对 `@jarvis/protocol` 的依赖（壳层不需要协议类型）。
- UI 文案必须 zh-CN / en 对称；`pnpm i18n:check` 必须通过；禁止硬编码用户可见字符串。
- Renderer 仅从 `@jarvis/core/renderer` 取纯逻辑（若触及）；ui 包自身无 core。
- 开发态 Vite `host: '127.0.0.1'`（TrustedRendererPolicy）；不得改回 `localhost`。
- CSP：`style-src 'self' 'unsafe-inline'`；样式用本地 CSS，禁外链字体 CDN。
- 强调色：中性墨蓝/石板蓝，禁止紫靛渐变主题。
- 字体栈：`"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`（sans）；等宽用 `"SF Mono", "Cascadia Code", "Consolas", monospace`。
- 默认主题：`light`（保留 `dark` / `system`）。
- 提交：每 Task 一次，`feat:` / `test:` / `fix:` 前缀；仅在用户要求时由执行者提交（若会话规则要求询问则先问）。
- 冷启动目标 &lt;3s：本阶段不加巨型 UI 运行时依赖。

## 文件结构总览

```
packages/ui/
  package.json                          # 去 protocol；peer react；vitest/jsdom/testing-library
  tsconfig.json                         # jsx: react-jsx
  vitest.config.ts
  src/
    index.ts                            # 导出组件 + 再导出令牌路径约定
    styles/tokens.css                   # 浅/深令牌 + body 基础
    components/
      Button.tsx / Button.css / Button.spec.tsx
      Panel.tsx / Panel.css / Panel.spec.tsx
      NavItem.tsx / NavItem.css / NavItem.spec.tsx
      NavGroup.tsx / NavGroup.css / NavGroup.spec.tsx
      Sidebar.tsx / Sidebar.css / Sidebar.spec.tsx
      TopBar.tsx / TopBar.css / TopBar.spec.tsx
      AppShell.tsx / AppShell.css / AppShell.spec.tsx

apps/desktop/
  package.json                          # 依赖 @jarvis/ui
  src/renderer/src/
    main.tsx                            # import '@jarvis/ui/tokens.css'（或从 ui index 副作用导入）
    styles/globals.css                  # 瘦身：仅保留桌面特有覆盖或删除重复令牌
    layouts/AppLayout.tsx               # 新建：壳 + 导航 + 顶栏接线
    layouts/AppLayout.spec.tsx
    layouts/SettingsLayout.tsx          # 高度改为填满主区，不再 100vh
    pages/ChatPage.tsx                  # 去掉跨页跳转按钮墙；Agent/Task 上移到顶栏
    App.tsx                             # 嵌套路由：壳内 Outlet；onboarding 壳外
    App.spec.tsx                        # 断言 shell 存在；导航可达
    components/theme/theme-store.ts     # mode 默认 'light'
    components/theme/theme-store.spec.ts

packages/i18n/locales/{zh-CN,en}/common.json
  # shell.nav.* / shell.group.* 键
```

---

### Task 1: `@jarvis/ui` 包基建与令牌 CSS

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/styles/tokens.css`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/styles/tokens.spec.ts`（读 CSS 文本断言关键变量存在）

**Interfaces:**
- Consumes: 无
- Produces: 包名 `@jarvis/ui`；导出路径：
  - `"."` → `./src/index.ts`
  - `"./tokens.css"` → `./src/styles/tokens.css`
  - `uiVersion` 常量保留
  - peerDependencies: `react`, `react-dom`（`^19.0.0`）
  - devDependencies: `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@types/react`, `@types/react-dom`
  - **删除** `dependencies["@jarvis/protocol"]`

- [ ] **Step 1: Write the failing token presence test**

```ts
// packages/ui/src/styles/tokens.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'tokens.css'), 'utf8');

describe('tokens.css', () => {
  it('defines light and dark surfaces and ink-blue accent', () => {
    expect(css).toMatch(/\[data-theme=['"]light['"]\]|:root/);
    expect(css).toMatch(/\[data-theme=['"]dark['"]\]/);
    for (const v of ['--bg', '--surface', '--surface-raised', '--border', '--border-subtle',
      '--fg', '--fg-muted', '--fg-faint', '--accent', '--accent-fg',
      '--success', '--warning', '--danger', '--info',
      '--space-1', '--radius-md', '--text-sm', '--font-sans', '--font-mono']) {
      expect(css).toContain(v);
    }
    expect(css).toMatch(/--accent:\s*#1f4e79/i);
    expect(css).not.toMatch(/#7c3aed|#8b5cf6|purple/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm vitest run src/styles/tokens.spec.ts`

Expected: FAIL（`tokens.css` 不存在或缺变量）

- [ ] **Step 3: Implement package.json, tsconfig, vitest, tokens.css, index**

`packages/ui/package.json`（关键字段）:

```json
{
  "name": "@jarvis/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/styles/tokens.css"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.0",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^30.0.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

`packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts']
  }
});
```

Create `packages/ui/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`packages/ui/src/styles/tokens.css`（完整最小集，色值可微调但 accent 必须为墨蓝 `#1f4e79` 浅色 / `#6b9fd4` 深色）:

```css
:root,
[data-theme='light'] {
  color-scheme: light;
  --bg: #f7f7f8;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --border: #e5e5e5;
  --border-subtle: #efefef;
  --fg: #0d0d0d;
  --fg-muted: #6b6b6b;
  --fg-faint: #9a9a9a;
  --accent: #1f4e79;
  --accent-fg: #ffffff;
  --success: #1b7f4e;
  --warning: #9a6b00;
  --danger: #b42318;
  --info: #1f4e79;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --font-sans: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", "Consolas", monospace;
  --shell-sidebar-width: 220px;
  --shell-topbar-height: 48px;
}

[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0f0f10;
  --surface: #18181a;
  --surface-raised: #222226;
  --border: #2e2e32;
  --border-subtle: #252528;
  --fg: #f3f3f3;
  --fg-muted: #a0a0a5;
  --fg-faint: #6e6e73;
  --accent: #6b9fd4;
  --accent-fg: #0f0f10;
  --success: #3dd68c;
  --warning: #f5b942;
  --danger: #f97066;
  --info: #6b9fd4;
}

html, body, #root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-md);
}
```

`packages/ui/src/index.ts`:

```ts
export const uiVersion = '0.1.0';
```

- [ ] **Step 4: Install and run tests**

Run: `cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && pnpm install && cd packages/ui && pnpm test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/ui/tsconfig.json packages/ui/vitest.config.ts packages/ui/vitest.setup.ts packages/ui/src/index.ts packages/ui/src/styles/tokens.css packages/ui/src/styles/tokens.spec.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: scaffold @jarvis/ui tokens for Codex-style shell

EOF
)"
```

---

### Task 2: Button 与 Panel primitives

**Files:**
- Create: `packages/ui/src/components/Button.tsx`, `Button.css`, `Button.spec.tsx`
- Create: `packages/ui/src/components/Panel.tsx`, `Panel.css`, `Panel.spec.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: tokens.css 变量（由应用入口导入；组件 CSS 只引用 `var(--*)`）
- Produces:
  - `ButtonProps`: `{ variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; disabled?: boolean; type?: 'button' | 'submit'; className?: string; children: React.ReactNode; onClick?: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>`（至少支持上列；可用 `Omit` 扩展原生 button 属性）
  - `PanelProps`: `{ elevated?: boolean; className?: string; children: React.ReactNode; as?: 'div' | 'section' }`
  - class 前缀：`jui-btn`, `jui-btn--primary|ghost|danger`, `jui-btn--sm|md`, `jui-panel`, `jui-panel--elevated`

- [ ] **Step 1: Write failing Button + Panel tests**

```tsx
// packages/ui/src/components/Button.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders primary variant and fires click', () => {
    const onClick = vi.fn();
    render(<Button variant="primary" onClick={onClick}>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn.className).toMatch(/jui-btn--primary/);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

```tsx
// packages/ui/src/components/Panel.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  it('applies elevated class when requested', () => {
    render(<Panel elevated data-testid="panel">Hi</Panel>);
    expect(screen.getByTestId('panel').className).toMatch(/jui-panel--elevated/);
  });
});
```

（若 `Panel` 用 `data-testid` 透传，在 props 上允许 `React.HTMLAttributes`。）

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd packages/ui && pnpm vitest run src/components/Button.spec.tsx src/components/Panel.spec.tsx`

- [ ] **Step 3: Implement Button + Panel + CSS + export**

`Button.tsx` 使用 `className` 拼接 `jui-btn jui-btn--${variant} jui-btn--${size}`；默认 `variant='ghost'`, `size='md'`, `type='button'`。

`Panel.tsx`：`div`（或 `as`）+ `jui-panel` + 可选 `jui-panel--elevated`；背景 `var(--surface)`，边框 `var(--border-subtle)`，圆角 `var(--radius-md)`，padding `var(--space-4)`。

从 `index.ts` 导出 `Button`, `Panel` 及类型。

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd packages/ui && pnpm test && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components packages/ui/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add @jarvis/ui Button and Panel primitives

EOF
)"
```

---

### Task 3: NavItem、NavGroup、Sidebar、TopBar、AppShell

**Files:**
- Create: `packages/ui/src/components/NavItem.tsx`, `NavItem.css`, `NavItem.spec.tsx`
- Create: `packages/ui/src/components/NavGroup.tsx`, `NavGroup.css`, `NavGroup.spec.tsx`
- Create: `packages/ui/src/components/Sidebar.tsx`, `Sidebar.css`, `Sidebar.spec.tsx`
- Create: `packages/ui/src/components/TopBar.tsx`, `TopBar.css`, `TopBar.spec.tsx`
- Create: `packages/ui/src/components/AppShell.tsx`, `AppShell.css`, `AppShell.spec.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Button/Panel 模式（class 前缀 `jui-*`）
- Produces:
  - `NavItemProps`: `{ active?: boolean; children: React.ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>` — 渲染 `<a>`（desktop 用 `NavLink` 的 `className`/`as` 模式时：也支持 **render-prop 免耦合**：优先实现为 `<a>`，AppLayout 用 `<NavLink className={...}>` 包一层或把 `NavLink` 的 `style/className` 函数结果传给 `NavItem` 的 `active`）。**推荐 API**：`NavItem` 只渲染 `<a>`，接受 `href`、`active`、`onClick`、`children`；AppLayout 用 `NavLink` 渲染时改为：

```tsx
<NavLink to={to} style={{ textDecoration: 'none' }}>
  {({ isActive }) => <NavItem active={isActive} asChild>{label}</NavItem>}
</NavLink>
```

为避免 `asChild` 复杂度，**本计划采用更简单 API**：

```ts
// NavItem 是展示用 <div role="link"> 或 <a>；AppLayout 这样用：
<NavLink to="/coding" className={({ isActive }) => `jui-navitem${isActive ? ' jui-navitem--active' : ''}`}>
  {t('menu.coding')}
</NavLink>
```

若采用该简化，则 **NavItem 组件** 仍导出供 Sidebar 文档化，API 为：

```ts
export type NavItemProps = {
  active?: boolean;
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
};
// 渲染 <a className={`jui-navitem ${active ? 'jui-navitem--active' : ''}`}> 
```

AppLayout 用 `NavItem` + `useNavigate` 或包 `NavLink`：

```tsx
<NavLink to={path} data-testid={tid}>
  {({ isActive }) => (
    <span className={`jui-navitem${isActive ? ' jui-navitem--active' : ''}`}>{label}</span>
  )}
</NavLink>
```

为保持 ui 包可测且 API 清晰，**实现 `NavItem` 为完整 `<a>`**，测试点 `active` class；AppLayout 用：

```tsx
<NavItem href={path} active={pathname === path || pathname.startsWith(path + '/')} onClick={(e) => { e.preventDefault(); navigate(path); }}>
  {label}
</NavItem>
```

  - `NavGroupProps`: `{ label: React.ReactNode; children: React.ReactNode }`
  - `SidebarProps`: `{ brand?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }`
  - `TopBarProps`: `{ left?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }`
  - `AppShellProps`: `{ sidebar: React.ReactNode; topBar?: React.ReactNode; children: React.ReactNode }`
  - testids（组件根）: `jui-appshell`, `jui-sidebar`, `jui-topbar`

- [ ] **Step 1: Write failing AppShell composition test**

```tsx
// packages/ui/src/components/AppShell.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';
import { Sidebar } from './Sidebar';
import { NavGroup } from './NavGroup';
import { NavItem } from './NavItem';
import { TopBar } from './TopBar';

describe('AppShell', () => {
  it('lays out sidebar, topbar, and main', () => {
    render(
      <AppShell
        sidebar={
          <Sidebar brand="JARVIS">
            <NavGroup label="Work">
              <NavItem href="/" active>Chat</NavItem>
            </NavGroup>
          </Sidebar>
        }
        topBar={<TopBar left="Agent" right="Tasks" />}
      >
        <div data-testid="main-slot">Main</div>
      </AppShell>
    );
    expect(screen.getByTestId('jui-appshell')).toBeTruthy();
    expect(screen.getByTestId('jui-sidebar')).toBeTruthy();
    expect(screen.getByTestId('jui-topbar')).toBeTruthy();
    expect(screen.getByTestId('main-slot')).toBeTruthy();
    expect(screen.getByText('Chat').className).toMatch(/jui-navitem--active/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/ui && pnpm vitest run src/components/AppShell.spec.tsx`

- [ ] **Step 3: Implement all shell components + CSS**

布局要求（`AppShell.css`）：

- `.jui-appshell`：`display: grid; grid-template-columns: var(--shell-sidebar-width) 1fr; grid-template-rows: var(--shell-topbar-height) 1fr; height: 100%; background: var(--bg);`
- sidebar 跨两行：`grid-row: 1 / -1`
- topbar 在右上；main 在右下 `overflow: auto; min-height: 0`
- Sidebar：左边框分隔 `border-right: 1px solid var(--border)`；背景 `var(--surface)`
- NavItem：块级、padding `var(--space-2) var(--space-3)`、圆角 `var(--radius-sm)`；`--active` 时背景 `var(--border-subtle)`、字重 600
- TopBar：flex、对齐、底边 `1px solid var(--border)`、背景 `var(--surface)`、padding 水平 `var(--space-4)`

导出全部组件。

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/ui && pnpm test && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "$(cat <<'EOF'
feat: add @jarvis/ui AppShell navigation primitives

EOF
)"
```

---

### Task 4: i18n 壳层文案键

**Files:**
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`
- Test: 根目录 `pnpm i18n:check`

**Interfaces:**
- Consumes: 现有 `menu.*`、`board.title`、`canvas.title`、`workflow.title`、`settings.title`、`app.title`
- Produces: 新增对称键：

```json
"shell": {
  "groupWork": "工作",
  "groupCollab": "协作",
  "navChat": "对话"
}
```

英文：

```json
"shell": {
  "groupWork": "Work",
  "groupCollab": "Collaborate",
  "navChat": "Chat"
}
```

其余导航标签复用：`menu.agents`、`menu.coding`、`menu.office`、`menu.squad`、`board.title`、`workflow.title`、`canvas.title`、`menu.settings`。

- [ ] **Step 1: Add keys to both locale files**

- [ ] **Step 2: Run i18n check**

Run: `cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && pnpm i18n:check`

Expected: PASS（键对称）

- [ ] **Step 3: Commit**

```bash
git add packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git commit -m "$(cat <<'EOF'
feat: add shell nav i18n keys for AppShell

EOF
)"
```

---

### Task 5: 默认浅色主题 + desktop 接入 tokens

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/theme/theme-store.ts`
- Modify: `apps/desktop/src/renderer/src/components/theme/theme-store.spec.ts`
- Modify: `apps/desktop/package.json`（`"@jarvis/ui": "workspace:*"`）
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`（删除与 tokens 重复的 `:root`/`[data-theme]`/body 规则，改为空文件或仅留注释；令牌以 `@jarvis/ui/tokens.css` 为准）

**Interfaces:**
- Consumes: `@jarvis/ui/tokens.css`
- Produces: `createThemeStore` 初始 `mode: 'light'`

- [ ] **Step 1: Write failing default-mode test**

在 `theme-store.spec.ts` 增加：

```ts
it('defaults mode to light', () => {
  const s = createThemeStore(() => true);
  expect(s.getState().mode).toBe('light');
});
```

- [ ] **Step 2: Run — expect FAIL**（当前默认 `system`）

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/theme/theme-store.spec.ts`

- [ ] **Step 3: Change default to `light`; wire CSS import; add dependency**

`theme-store.ts`: `mode: 'light'`。

`main.tsx` 在现有 globals 导入处改为：

```ts
import '@jarvis/ui/tokens.css';
import './styles/globals.css';
```

`globals.css` 清空重复令牌（可留一行注释 `/* desktop overrides — tokens live in @jarvis/ui */`）。

`apps/desktop/package.json` dependencies 增加 `"@jarvis/ui": "workspace:*"`。

Run: `pnpm install`（仓库根）。

- [ ] **Step 4: Run theme tests + typecheck desktop**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/theme/theme-store.spec.ts && pnpm typecheck`

Expected: PASS（若 typecheck 因未用 ui 组件失败则至少 theme 测试 PASS）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json apps/desktop/src/renderer/src/main.tsx apps/desktop/src/renderer/src/styles/globals.css apps/desktop/src/renderer/src/components/theme/theme-store.ts apps/desktop/src/renderer/src/components/theme/theme-store.spec.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: default light theme and import @jarvis/ui tokens

EOF
)"
```

---

### Task 6: `AppLayout` + 路由套壳 + Chat 去按钮墙

**Files:**
- Create: `apps/desktop/src/renderer/src/layouts/AppLayout.tsx`
- Create: `apps/desktop/src/renderer/src/layouts/AppLayout.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPage.tsx`
- Modify: `apps/desktop/src/renderer/src/layouts/SettingsLayout.tsx`

**Interfaces:**
- Consumes: `@jarvis/ui` 的 `AppShell`, `Sidebar`, `NavGroup`, `NavItem`, `TopBar`；`useNavigate`, `useLocation`；`useTranslation`；`AgentSwitcher`；`TaskControlBar`；`LanguageSwitcher`（可放 Sidebar footer）
- Produces:
  - `AppLayout` 渲染壳；`data-testid="app-shell"` 加在外层（可与 `jui-appshell` 并存）
  - 导航项与 testid：

| to | testid | label key |
|----|--------|-----------|
| `/` | `nav-chat` | `shell.navChat` |
| `/agents` | `nav-agents` | `menu.agents` |
| `/coding` | `nav-coding` | `menu.coding` |
| `/office` | `nav-office` | `menu.office` |
| `/squad` | `nav-squad` | `menu.squad` |
| `/board` | `nav-board` | `board.title` |
| `/workflow` | `nav-workflow` | `workflow.title` |
| `/canvas` | `nav-canvas` | `canvas.title` |
| `/settings/providers` | `nav-settings` | `menu.settings` |

  - Active 规则：`pathname === to` 或（settings）`pathname.startsWith('/settings')`；agents 含 `/agents/templates` 时 `nav-agents` active。
  - `App.tsx` 结构：

```tsx
<Routes>
  <Route path="/onboarding" element={<OnboardingPage />} />
  <Route element={<AppLayout />}>
    <Route path="/" element={onboardingDone ? <ChatPage /> : <Navigate to="/onboarding" replace />} />
    <Route path="/agents" element={<AgentListView />} />
    <Route path="/agents/templates" element={<AgentTemplatesPage />} />
    <Route path="/coding" element={<CodingPanelPage />} />
    <Route path="/office" element={<OfficePage />} />
    <Route path="/squad" element={<SquadViewPage />} />
    <Route path="/board" element={<TaskBoardPage />} />
    <Route path="/workflow" element={<WorkflowPage />} />
    <Route path="/canvas" element={<CanvasPage />} />
    <Route path="/settings" element={<SettingsLayout />}>
      {/* 现有子路由不变 */}
    </Route>
  </Route>
</Routes>
```

  - `ChatPage`：**删除**所有 `chat-to-*` 跳转按钮；保留会话列表 + `chat-new`；**移除**页内 `AgentSwitcher` / `TaskControlBar` / `LanguageSwitcher`（改由顶栏/侧栏 footer 提供）。高度用 `height: '100%'` 而非 `100vh`。
  - `SettingsLayout`：`minHeight: '100%'`（或 `height: '100%'`），不再 `100vh`。
  - TopBar：`left={<AgentSwitcher />}`，`right={<TaskControlBar />}`。

- [ ] **Step 1: Write AppLayout failing test**

```tsx
// apps/desktop/src/renderer/src/layouts/AppLayout.spec.tsx
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { AppLayout } from './AppLayout';

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  });
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: vi.fn(async () => []),
    onDidReceive: () => () => {}
  };
});

describe('AppLayout', () => {
  it('renders shell nav targets', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div data-testid="child">child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('app-shell')).toBeTruthy();
    expect(screen.getByTestId('nav-chat')).toBeTruthy();
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/layouts/AppLayout.spec.tsx`

- [ ] **Step 3: Implement AppLayout, rewire App.tsx, slim ChatPage & SettingsLayout**

`AppLayout.tsx` 伪代码要点：

```tsx
export function AppLayout() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const item = (to: string, tid: string, label: string, active: boolean) => (
    <NavItem
      key={to}
      href={to}
      data-testid={tid}
      active={active}
      onClick={(e) => { e.preventDefault(); void navigate(to); }}
    >
      {label}
    </NavItem>
  );
  return (
    <div data-testid="app-shell" style={{ height: '100%' }}>
      <AppShell
        sidebar={
          <Sidebar brand={<strong>{t('app.title')}</strong>} footer={<LanguageSwitcher />}>
            <NavGroup label={t('shell.groupWork')}>
              {item('/', 'nav-chat', t('shell.navChat'), pathname === '/')}
              {item('/agents', 'nav-agents', t('menu.agents'), pathname.startsWith('/agents'))}
              {item('/coding', 'nav-coding', t('menu.coding'), pathname.startsWith('/coding'))}
              {item('/office', 'nav-office', t('menu.office'), pathname.startsWith('/office'))}
            </NavGroup>
            <NavGroup label={t('shell.groupCollab')}>
              {item('/squad', 'nav-squad', t('menu.squad'), pathname.startsWith('/squad'))}
              {item('/board', 'nav-board', t('board.title'), pathname.startsWith('/board'))}
              {item('/workflow', 'nav-workflow', t('workflow.title'), pathname.startsWith('/workflow'))}
              {item('/canvas', 'nav-canvas', t('canvas.title'), pathname.startsWith('/canvas'))}
            </NavGroup>
            <div style={{ marginTop: 'auto' }}>
              {item('/settings/providers', 'nav-settings', t('menu.settings'), pathname.startsWith('/settings'))}
            </div>
          </Sidebar>
        }
        topBar={<TopBar left={<AgentSwitcher />} right={<TaskControlBar />} />}
      >
        <Outlet />
      </AppShell>
    </div>
  );
}
```

（若 Sidebar 未把 footer 推到底，用 flex 列 + `marginTop: auto` 包住设置项即可。）

更新 `App.spec.tsx`：在「renders chat page when onboarding is done」中增加：

```ts
expect(screen.getByTestId('app-shell')).toBeTruthy();
expect(screen.getByTestId('nav-chat')).toBeTruthy();
```

在 onboarding 用例中断言：

```ts
expect(screen.queryByTestId('app-shell')).toBeNull();
```

- [ ] **Step 4: Run desktop tests**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/layouts/AppLayout.spec.tsx src/renderer/src/App.spec.tsx src/renderer/src/components/theme/theme-store.spec.ts`

Expected: PASS

另跑：`cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && pnpm i18n:check`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/layouts/AppLayout.tsx apps/desktop/src/renderer/src/layouts/AppLayout.spec.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.spec.tsx apps/desktop/src/renderer/src/pages/ChatPage.tsx apps/desktop/src/renderer/src/layouts/SettingsLayout.tsx
git commit -m "$(cat <<'EOF'
feat: wire AppShell layout across desktop routes

EOF
)"
```

---

### Task 7: P0 验收（手工 + 包测试）

**Files:** 无新文件（修复则随前序 Task）

- [ ] **Step 1: 跑 ui + desktop 相关测试与 i18n**

Run:

```bash
cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis
pnpm i18n:check
cd packages/ui && pnpm test && pnpm typecheck
cd ../../apps/desktop && pnpm vitest run src/renderer/src/App.spec.tsx src/renderer/src/layouts/AppLayout.spec.tsx src/renderer/src/components/theme/theme-store.spec.ts
```

Expected: 全部 PASS

- [ ] **Step 2: 手工启动（若本机可跑 Electron）**

```bash
cd apps/desktop
pnpm build:daemon   # 若 resources/daemon 缺失
pnpm rebuild:electron
pnpm dev
```

验收清单：
- [ ] 窗口打开，无 `IPC_UNTRUSTED_ORIGIN`
- [ ] 左侧可见分组导航；点击可到 coding/settings/board 等
- [ ] 顶栏有 Agent 切换与任务条
- [ ] 对话页无跨页跳转按钮墙；会话列表仍在
- [ ] Onboarding（若重置）全屏无壳
- [ ] `data-theme="light"` 为默认；切换 dark 后表面色变化

- [ ] **Step 3: 若有修复，单独 commit；否则无 commit**

---

## Spec 覆盖自检（P0）

| Spec 项 | Task |
|---------|------|
| `packages/ui` 令牌浅/深 + 墨蓝 accent | T1 |
| Button / Panel | T2 |
| AppShell / Sidebar / TopBar / Nav* | T3 |
| ui 无 core/IPC/zustand/protocol | T1 package.json |
| 默认浅色 | T5 |
| desktop 导入 tokens | T5 |
| 统一壳 + 导航分组 + 设置入口 | T6 |
| Onboarding 壳外 | T6 |
| 顶栏 Agent + 任务控制 | T6 |
| Chat 去掉跳转墙 | T6 |
| i18n 对称 | T4 |
| 不引入 Tailwind（P0） | 全文 |
| P1 Chat StepCard / Composer | **不在本计划**（下期） |
| P2 Settings 视觉精修 | **不在本计划** |
| P3 其余页精修 | **不在本计划** |

## Placeholder 扫描

无 TBD/TODO；组件 API 与测试代码均已写出。

## 类型一致性

- `NavItem` / `AppShell` / `TopBar` / `Sidebar` / `NavGroup` 名称在 T3 与 T6 一致。
- `data-testid`：`jui-appshell`（ui）与 `app-shell`（desktop 包装）并存；导航用 `nav-*`。

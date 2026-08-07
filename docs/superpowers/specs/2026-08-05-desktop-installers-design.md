# 桌面端安装包构建方案：Windows MSI + macOS 双 DMG

日期：2026-08-05
状态：设计已确认，待实现

## 1. 目标

为 `@jarvis/desktop`（Electron 32 + electron-vite，pnpm/turbo 单仓库）产出可分发的桌面安装包，全部落到仓库根目录 `dist/`。**安装包与指纹文件跟踪入库**（`.gitignore` 从整体忽略 `dist/` 改为白名单：仅跟踪 `*.msi` / `*.dmg` / `*.sha256`，electron-builder 中间产物如 `*-unpacked/`、`mac/`、构建缓存、日志仍忽略）；此边界按文件大小可调：若单文件接近 GitHub 单文件上限（100MB），改回整体忽略 `dist/` 并改走 GitHub Releases 分发。

| 平台 | 架构 | 安装包文件 | 指纹文件 |
|---|---|---|---|
| Windows | x64（文件名写作 `x86`） | `Jarvis_1.0.0-Preview_x86.msi` | `Jarvis_1.0.0-Preview_x86.msi.sha256` |
| macOS | x64（Intel） | `Jarvis_1.0.0-Preview_x64.dmg` | `Jarvis_1.0.0-Preview_x64.dmg.sha256` |
| macOS | arm64（Apple Silicon） | `Jarvis_1.0.0-Preview_arm64.dmg` | `Jarvis_1.0.0-Preview_arm64.dmg.sha256` |

指纹内容统一为 `<64位SHA256哈希>  <文件名>`（GNU `sha256sum` 兼容格式），算法为 SHA-256。

## 2. 已确认的决策

1. **构建环境**：GitHub Actions CI。MSI 依赖 Windows 原生的 WiX 工具集，`electron-builder` 官方不支持在 macOS/Linux 产出 `.msi`，必须在 Windows 构建；macOS dmg 在 macOS runner 上原生构建。
2. **Windows 架构**：x64（`electron-builder` `arch: x64`）。文件名中的 `_x86` 按用户要求保留，仅表示构建参数走 x64。
3. **指纹算法**：SHA-256，指纹文件为 `.sha256`。
4. **macOS 产物形态**：按架构拆分为两个 dmg（不做 universal 单文件）。
5. **方案范围**：Windows MSI 与 macOS 双 dmg 在同一方案中一次完成。
6. **版本号**：仓库与各 workspace `package.json` 统一为 `1.0.0-Preview`。electron-builder 的 `${version}` 直接展开为 `1.0.0-Preview`，**产物文件名不再做下划线替换**（统一为 `Jarvis_1.0.0-Preview_x86.msi` 等）。MSI 的 ProductVersion 由 electron-builder 从 semver 派生，正常取数字部分 `1.0.0`（Windows 安装器元数据不允许预发布后缀）；若 MSI 目标对 `1.0.0-Preview` 报错，则 MSI job 改为注入 `1.0.0`，`-Preview` 仍保留在文件名中。

## 3. 关键约束与事实

- **MSI 必须在 Windows 构建**（WiX 工具集，Windows 原生），已通过 electron-builder 官方文档核实。
- **Go daemon 是纯 Go**（`modernc.org/sqlite`，无 cgo），可从任意平台交叉编译到 `windows/amd64`、`darwin/amd64`、`darwin/arm64`。
- **原生模块 `better-sqlite3`** 提供各平台/架构的 Electron 预编译产物，electron-builder 按目标架构自动下载，无需本机编译。跨架构构建（如在 Intel 上构建 arm64）可行，但**无法在本机运行验证 arm64 版**（Rosetta 只能 ARM 跑 x64，不能反向）。
- **GitHub Actions macOS runner 计费是 Linux 的 10 倍**，因此 macOS 两个架构在**同一个 runner job 内顺序构建**（而不是开两个 macOS job），省一半 macOS 分钟。

## 4. 组件与改动清单

### 4.1 `apps/desktop/electron-builder.yml`（新增）

electron-builder 统一打包配置。关键项：

```yaml
appId: com.jarvis.app
productName: Jarvis
directories:
  output: ../../dist          # 产物直接落到仓库根目录 dist/
  buildResources: resources
files:
  - out/**                    # electron-vite 构建产物（main/preload/renderer）
  - resources/**              # 内含 daemon 二进制
  - package.json
asar: true
npmRebuild: true              # 打包时按目标架构重建原生模块

win:
  target:
    - target: msi
      arch: [x64]
  artifactName: Jarvis_${version}_x86.${ext}

msi:
  oneClick: false
  perMachine: true            # 企业分发常用，MSI 需要管理员权限

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [x64, arm64]
  artifactName: Jarvis_${version}_${arch}.${ext}
  hardenedRuntime: false      # 预览版不签名，故不启用；拿到证书后再开
  gatekeeperAssess: false
  identity: null              # 预览版跳过签名
```

说明：
- `files` 白名单只打包 `out/`、`resources/`、`package.json` 及生产依赖 node_modules，避免把 `src/`、测试文件带进安装包。
- `${version}` 来自 `apps/desktop/package.json`（`1.0.0-Preview`），`artifactName` 直接产出最终文件名，无需 CI 重命名步骤。

### 4.2 `apps/desktop/src/main/daemon/DaemonSupervisor.ts`（改一行）

`DaemonSupervisor.ts:148` 目前硬编码 daemon 路径 `resources/daemon/jarvis-daemon`（无后缀），Windows 上 spawn 找不到 `jarvis-daemon.exe`。改为按平台拼后缀：

```ts
const DAEMON_NAME = process.platform === 'win32' ? 'jarvis-daemon.exe' : 'jarvis-daemon';
// 构造器默认值：
constructor(private binaryPath = join(import.meta.dirname, '../../../resources/daemon', DAEMON_NAME)) {}
```

- macOS 双 dmg 为**分开构建**，每个包内只放对应架构的 daemon，路径不变、无需运行时按 arch 选择 → **macOS 侧零额外代码**。
- 这是唯一的运行时代码改动，其余均为构建配置与脚本。

### 4.3 `apps/desktop/package.json`（加 3 个构建脚本）

在现有 `build:daemon` 之外新增（现有脚本面向 macOS 开发机，不动）：

```json
"build:daemon:win": "cd ../../daemon && GOOS=windows GOARCH=amd64 go build -o ../apps/desktop/resources/daemon/jarvis-daemon.exe ./cmd/jarvis-daemon",
"build:daemon:darwin:x64": "cd ../../daemon && GOOS=darwin GOARCH=amd64 go build -o ../apps/desktop/resources/daemon/jarvis-daemon ./cmd/jarvis-daemon",
"build:daemon:darwin:arm64": "cd ../../daemon && GOOS=darwin GOARCH=arm64 go build -o ../apps/desktop/resources/daemon/jarvis-daemon ./cmd/jarvis-daemon"
```

### 4.4 `.github/workflows/build-installers.yml`（新增）

两个 job，`workflow_dispatch`（网页手动触发，带版本号输入框，默认 `1.0.0-Preview`）+ `1.0.0-Preview.0-preview*` tag 触发。

**job `windows-msi`（`runs-on: windows-latest`）：**

1. checkout → `setup-node@v4`（node 20）→ `pnpm/action-setup@v4`（9.12.0）→ `setup-go@v5`（go 1.25.x）
2. `pnpm install --frozen-lockfile`
3. `pnpm build`（turbo 构建所有包）
4. `cd apps/desktop && pnpm build:daemon:win`
5. `cd apps/desktop && npx electron-builder install-app-deps`（按 Electron ABI + x64 重建 better-sqlite3；pnpm monorepo 下的可靠路径）
6. `cd apps/desktop && npx electron-builder --win msi --x64`
7. 生成指纹（pwsh；**无 `working-directory`，从仓库根目录运行**）：

   ```powershell
   $dist = "$env:GITHUB_WORKSPACE\dist"
   $msi = Join-Path $dist "Jarvis_1.0.0-Preview_x86.msi"
   $h = (Get-FileHash -Algorithm SHA256 $msi).Hash.ToLower()
   "$h  Jarvis_1.0.0-Preview_x86.msi" | Set-Content -Encoding ascii "$dist\Jarvis_1.0.0-Preview_x86.msi.sha256"
   node scripts/release/verify-artifacts.mjs
   ```

8. `actions/upload-artifact@v4` 上传 msi + sha256

> 注：electron-builder 在 `apps/desktop` 下执行，`directories.output: ../../dist` 使产物落到**仓库根目录 `dist/`**。指纹与 `verify-artifacts` 在仓库根目录执行，统一用 `$GITHUB_WORKSPACE` 定位。

**job `macos-dmg`（一个 macOS runner，顺序构建两个架构）：**

1. checkout → setup-node → pnpm → setup-go（同 windows job）
2. `pnpm install --frozen-lockfile`
3. `pnpm build`
4. **x64 构建**：
   - `cd apps/desktop && pnpm build:daemon:darwin:x64`
   - `cd apps/desktop && npx electron-builder install-app-deps`
   - `cd apps/desktop && npx electron-builder --mac dmg --x64`
   - 指纹（bash；从仓库根目录运行）：

     ```bash
     cd "$GITHUB_WORKSPACE/dist"
     shasum -a 256 Jarvis_1.0.0-Preview_x64.dmg > Jarvis_1.0.0-Preview_x64.dmg.sha256
     ```

5. **arm64 构建（重新编译 daemon！）**：
   - `cd apps/desktop && pnpm build:daemon:darwin:arm64`
   - `cd apps/desktop && npx electron-builder install-app-deps`
   - `cd apps/desktop && npx electron-builder --mac dmg --arm64`
   - 指纹：

     ```bash
     cd "$GITHUB_WORKSPACE/dist"
     shasum -a 256 Jarvis_1.0.0-Preview_arm64.dmg > Jarvis_1.0.0-Preview_arm64.dmg.sha256
     node "$GITHUB_WORKSPACE/scripts/release/verify-artifacts.mjs"
     ```

6. `actions/upload-artifact@v4` 上传两个 dmg + 两个 sha256

> ⚠️ **关键约束**：两个 dmg 必须走**两次独立的 electron-builder 调用**，且每次调用前先编译对应架构的 daemon。不能 `--x64 --arm64` 一次打两个——`resources/daemon/jarvis-daemon` 是共享路径，一次调用会把同一个 daemon 二进制打进两个包，导致其中一个架构不匹配。
>
> runner 选择：优先 `macos-13`（x64 runner，可原生构建 x64、通过 prebuild 下载 arm64）；若该标签被 GitHub 下线，改用 `macos-latest`（arm64 runner，反向操作）。两者都可行，因为 better-sqlite3 有双架构预编译产物。
>
> 环境变量：两个 job 均设置 `CSC_IDENTITY_AUTO_DISCOVERY: false`（无证书时跳过签名发现，避免构建失败）。

### 4.5 本地收尾

CI 上传的 6 个文件（msi + 2 dmg + 3 sha256）从 GitHub Actions 页面手动下载到 `dist/`。本机未安装 `gh`/docker，浏览器下载即可；如需自动化，可后续补一个基于 GitHub API 的下载脚本（`gh run download` 或 REST API），本次不做。

## 5. 错误处理与边界情况

- **版本号未传**：workflow 输入默认 `1.0.0-Preview`。
- **原生模块预编译缺失**：better-sqlite3 若缺某架构 prebuild，electron-builder 会退回本机编译——Windows runner 自带 MSVC、macOS runner 自带 clang，可编译；但**跨架构本机编译不可行**，此时对应架构构建会报错失败，属于预期内硬失败，会在 CI 日志中明确暴露。
- **重命名冲突**：产物文件名由 `electron-builder.yml` 的 `artifactName` 固定，不再依赖 `Get-ChildItem` 重命名。
- **daemon 二进制未编译就打包**：会静默打进旧/错误架构二进制。CI 步骤顺序保证每次打包前都重编译 daemon（见 4.4），不得重排。
- **本地 `resources/daemon/jarvis-daemon` 是 gitignore 的**：本地开发机器上的二进制不会污染 CI（CI 全新 checkout）。

## 6. 验证方式

1. **构建层**：CI 三个产物（msi + 2 dmg）与三个 `.sha256` 全部产出并成功上传。
2. **指纹校验**：下载后本地执行 `shasum -a 256 -c Jarvis_1.0.0-Preview_x64.dmg.sha256`（Windows 用 `Get-FileHash` 对比），哈希一致；或运行 `node scripts/release/verify-artifacts.mjs`（读取 `dist/`）。
3. **安装层（Windows）**：在一台 Windows 机器上安装 msi，确认应用启动、daemon 进程拉起（健康检查端口 17890），确认 `resources/daemon/jarvis-daemon.exe` 存在于安装目录。
4. **安装层（macOS）**：挂载 dmg 拷贝 App，右键→打开（未签名预览包），确认 daemon 拉起。
5. **架构校验**：对每个包内 daemon 执行 `file` 确认 Mach-O 架构（`x86_64` / `arm64`）与包名匹配——用于捕获 4.4 中"打进错误架构 daemon"的问题。
6. **回归**：`pnpm typecheck` / `pnpm test` 通过（运行时改动仅 DaemonSupervisor 一行）。

## 7. 已知限制与后续工作

- **dist 产物入库**：安装包 + 指纹文件跟踪入库（`.gitignore` 白名单）。⚠️ **体积风险**：Electron 的 MSI/dmg 通常 60–150MB，GitHub 对单文件有 50MB 告警、100MB 硬上限；若产物超限，push 会被拒。届时按"文件大小调整"约定：`dist/` 改回整体忽略，改用 GitHub Releases（单文件上限 2GB）分发，`.gitignore` 已注明该回退路径。
- **未签名**：Windows SmartScreen 首次运行有警告；macOS 预览包下载后有 Gatekeeper 拦截（右键→打开）。正式发布需：Apple Developer 账号（$99/年）+ Developer ID 证书 + notarytool 公证，以及 Windows 代码签名证书；electron-builder 配置已留位，拿到证书后开启 `hardenedRuntime` 与签名即可。
- **默认图标**：未提供自定义图标，使用 Electron 默认图标；后续补 `build/icon.ico` + `.icns`。
- **版本号注入**：`1.0.0-Preview` 仅存在于构建时；仓库 `package.json` 版本为 `1.0.0-Preview`，正式发版时再统一升版本。
- **自动更新**（zip/electron-updater）：本次不做，`mac.target` 未来可加 `zip`。
- **产物下载**：当前为手动从 Actions 下载；可后续加下载脚本。

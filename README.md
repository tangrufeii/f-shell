# FShell

一个用 Rust 驱动、用 Tauri 2 承载现代桌面体验的 Shell 工作台。目标不是再抄一个臃肿的 FinalShell，而是做一个更现代、更顺手、更能扩展的终端 + 文件操作平台。

## 当前阶段

- 已迁回 `Tauri 2 + React + TypeScript`
- 已接入 `xterm.js`，终端前端不再是假日志占位
- 已接入 Rust 侧真实 SSH 会话和真实 SFTP 文件浏览 / 文本预览 / 文本保存
- 已按透明毛玻璃方向重做主工作台 UI
- 已补产品级应用图标资产，替换占位任务栏图标
- 已接入 Tauri 2 在线更新客户端链路和更新产物生成
- 已接入 GitHub Releases 自动发版工作流
- 当前仍待补：多连接管理、密钥认证、图片/PDF 专用预览器

## 目录结构

```text
.
├─ src/                 # 前端工作台
├─ src-tauri/           # Rust 后端与桌面配置
│  ├─ src/commands.rs   # Tauri 命令接口
│  ├─ src/models.rs     # 数据模型
│  └─ tauri.conf.json   # 窗口与构建配置
├─ tools/generate-update-manifest.ps1  # 生成 latest.json 更新清单
└─ README.md
```

## 后续开发建议

1. 多连接与凭据
   现在是单活跃连接，下一步要补本地加密存储、私钥认证、ssh-agent、跳板机。
2. 文件传输队列
   抽出上传 / 下载任务模型，把拖拽上传、覆盖确认、冲突处理做完整。
3. 预览器层
   当前文本预览已真实可用，但图片、PDF、二进制还只是类型识别，需要接专门渲染器。
4. 会话增强
   补标签页、分屏、重连、保活、主题切换和终端配置。
5. 在线更新
   客户端已经指向 GitHub Releases 的 `latest.json` 端点，配好仓库 Secrets 并跑一次 GitHub Actions 发布后，应用内检查更新就能真正生效。

## 启动

```bash
npm install
npm run tauri dev
```

## GitHub 发布与在线更新

当前仓库已经把 updater 端点指向 GitHub Releases：

- [tauri.conf.json](/C:/Users/10427/Desktop/fshell/src-tauri/tauri.conf.json)
- `https://github.com/tangrufeii/f-shell/releases/latest/download/latest.json`

你现在只需要把 GitHub 仓库 Secret 配好，然后按版本号打 tag 推上去，GitHub Actions 就会自动发布。

1. 先在本地生成 updater 私钥

```bash
npx tauri signer generate -w .tauri/fshell-updater.key
```

2. 打开仓库 `Settings -> Secrets and variables -> Actions`，新增这些 Secrets

- `TAURI_SIGNING_PRIVATE_KEY`
  这里填 `.tauri/fshell-updater.key` 的完整文本内容，不是文件路径。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  如果你的私钥设置了密码就填；你现在这把无密码私钥可以先不填。

3. 提交版本改动后，打上和版本号一致的 tag 并推送

- 工作流文件在 [release.yml](/C:/Users/10427/Desktop/fshell/.github/workflows/release.yml)
- 例如当前版本是 `0.2.1`，就执行：

```bash
git tag v0.2.1
git push origin main --tags
```

- 工作流会自动构建：
  - `NSIS setup.exe`
  - `MSI`
  - `.sig`
  - `latest.json`
- 并自动上传到 GitHub Release

4. 如果你临时不想打 tag，仍然可以去 GitHub `Actions` 页手动运行 `Release Desktop`

5. 之后客户端点“检查更新”就会读取最新 Release 的 `latest.json`

## 手动发布备用方案

如果你不想走 GitHub Actions，仓库里仍然保留了本地手动生成 `latest.json` 的脚本：

- [generate-update-manifest.ps1](/C:/Users/10427/Desktop/fshell/tools/generate-update-manifest.ps1)

## Windows 打包语言

- NSIS 安装器已切到简体中文
- WiX / MSI 语言已切到 `zh-CN`
- Windows 发布版已关闭额外控制台窗口

## 注意

现在这一版是“现代 Shell 产品骨架”，不是完整替代 FinalShell 的成熟成品。界面和模块边界已经立住，后面继续往里填 SSH、SFTP、预览器和编辑能力就行。别一开始就把所有能力塞进一个大组件，那玩意最后只会烂掉。

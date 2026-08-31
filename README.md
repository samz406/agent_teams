# Moxt · AI Team Runtime

Moxt 是一个面向真实软件研发的本地 AI Team Runtime：人通过 Team Chat 管理一组长期责任 Agent，Agent 绑定用户本机真实安装的 Claude Code、Codex、OpenCode、pi 或 Custom CLI，在真实 Workspace 中执行任务；所有正式回复都关联 Run、Runtime 输出、Git 状态、Diff 和 Evidence，不使用前端模拟 Worker 冒充执行结果。

## 当前可运行能力

- 跨平台 Electron + React + TypeScript 桌面端，Renderer 无 Node/文件/Shell 权限，通过受控 IPC 调用本地 Runtime。
- SQLite WAL 本地持久化 Change、Agent、Workspace、Message、Run、Artifact、Evidence 和审计 Event；应用重启会把未结束 Run 恢复为 `INTERRUPTED`，不会静默标记完成。
- 自动从登录 Shell 环境检测 Claude Code、Codex、OpenCode、pi；支持 Agent 绑定自定义 executable。CLI 使用参数数组启动而不是拼接 Shell 字符串。
- Run 状态、stdout/stderr 流式 Activity、真实进程暂停语义（中断 + Checkpoint）、终止、Resume/Retry 父子谱系、Exit Code、Session ID、Git 状态、Diff 和变更文件证据。
- 一个 Change 可挂载多个本地 Workspace、多个 Agent；同一 Team Session 可并行运行多个真实 CLI。用户可直接指定 Agent；Leader 的 Final Response 可通过 `team-actions` 协议委派最多三个真实 Worker Run。
- 内置跨项目协作、线上会诊、Bug 修复、大型重构、发布前检查五种责任流；`IN_LOOP` 阶段由 Artifact Approval 强制 Gate，`RUN_COMPLETED` 不会自动推进 Workflow 或将 Change 标记 Done。
- 工作台、新建任务五步流程、Team Chat、实时 Agent Inspector、Session/Run 历史、Workflow 阶段、Artifact 版本与审批、Agent 管理、Runtime 设置等核心页面。

## 本地运行

要求 Node.js 22+、Git，以及至少一个已登录的 Coding Agent CLI。

```bash
npm install
npm run dev
```

首次打开后：在“新建任务”中选择协作模式，填写目标，挂载一个或多个本地项目目录，选择 Agent；进入 Team Chat 后选择目标 Agent 并发送任务。Moxt 只在收到任务后启动真实 CLI，使用 CLI 自己已有的本机登录态，不保存 API Key。

## 验证与打包

```bash
npm run typecheck
npm test
npm run build
npm run package
```

`npm run package` 会生成当前操作系统的未签名安装目录；正式 DMG/NSIS/AppImage 使用 `npm run dist`，macOS 公证和 Windows 签名需要在 CI 中配置对应证书。

## Leader 委派协议

Leader 或任意 Agent 需要另一成员参与时，可在真实 Final Response 末尾输出：

````markdown
```team-actions
[{"agent":"QA Agent","prompt":"使用原 Reproduction Case 做独立验证，并返回命令和测试证据"}]
```
````

Runtime 会查找当前 Agent Pool 中的目标责任角色，并为它创建新的真实 Run；找不到 Agent、目标不在团队或 Runtime 不可用时不会伪造回复。

## 安全和数据位置

主窗口仅加载本地打包资源并启用 CSP、`contextIsolation`、sandbox 和 `nodeIntegration: false`。数据库位于 Electron `userData/database/moxt.db`；源码保留在用户选择的 Workspace，Moxt 不上传源码。停止 Run 默认保留工作区现场，不执行 `git reset --hard`。

## 工程边界

当前仓库完成了可实际运行的 V0.1 纵向主链路，但发布级产品仍需要真实项目验收与平台工程收尾：独立 Git Worktree 自动创建/回收、Windows ConPTY 交互终端、Transcript 文件分片、结构化 Integration Case/Handoff/Issue 实体、签名公证、自动更新以及五类场景的真实 E2E 基准项目。这些项目不会用 Mock 冒充“已验收”；详细状态见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

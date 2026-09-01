# Agent Teams · AI Team Runtime

Agent Teams 是一个面向真实软件研发的本地 AI Team Runtime：人通过 Team Chat 管理一组长期责任 Agent，Agent 绑定用户本机真实安装的 Claude Code、Codex、OpenCode、pi 或 Custom CLI，在真实 Workspace 中执行任务；所有正式回复都关联 Run、Runtime 输出、Git 状态、Diff 和 Evidence，不使用前端模拟 Worker 冒充执行结果。

## 当前可运行能力

- 跨平台 Electron + React + TypeScript 桌面端，Renderer 无 Node/文件/Shell 权限，通过受控 IPC 调用本地 Runtime。
- Main 与 Agent Runtime 运行在独立 Electron Utility Process；Runtime 通过正式 Adapter 接入 Claude Code、Codex、OpenCode、pi 和 Custom CLI，并使用全局并发队列限制活动进程数。
- SQLite WAL 持久化 Change、Task、Workstream、AgentSession、Handoff、Issue、HumanIntervention、Run、Artifact、Evidence 和审计 Event；进程重启会把残留 Run/Session/Task/Workstream 恢复为可解释的中断或阻塞状态。
- 新建任务会立即持久化首个 Task，并自动启动 Leader 的真实 CLI Run；如果 Runtime 未安装或启动失败，Change/Task 会保留为 BLOCKED，不会因为启动失败把任务丢掉。
- Team Chat 的 `/status` 与常见状态查询直接读取 Agent Teams 的持久化 Source of Truth，不会暂停正在工作的 Agent；普通纠偏指令仍按 Human Intervention 形成 Parent Run 谱系。
- AgentSession 保存原生 CLI Session ID；Pause、Resume、Retry 形成 Parent Run 谱系，支持 Claude/Codex/OpenCode 的原生 Session Resume，并保存 stdout/stderr、Exit Code、Git、Diff、测试和命令证据。
- 每个 Change 都显式建立 Agent-Workspace Binding。写权限 Agent 必须绑定 Git Workspace，并在 `userData/worktrees` 中使用独立 Branch/Worktree；Adapter 无法强制满足权限时会拒绝启动，不会静默放宽。
- Leader Engine 驱动 `ASSIGNED → RUNNING → RUN_COMPLETED → VERIFYING → ACCEPTED/REWORK` 状态机；Exit 0 不是验收，缺少阶段要求的 Runtime/Diff/Test Evidence 会生成 Blocking Issue，阻止 Workflow 推进。
- 一个 Change 可挂载多个 Workspace、Agent 和 Workstream；Agent 的 `team-actions` 只允许向当前 Session Team 委派，并创建真实 Task、Run 与 Handoff。
- 内置五种责任流；AUTO 阶段仅在全部 Task 验收且无 Blocking Issue 时推进，人工 Gate 仍要求批准 Artifact，Bug Fix 最终验证强制由非实现 Agent 完成。
- 独立“多人聊天”模式支持圆桌、头脑风暴、正反辩论和专家会诊：系统按模式生成差异化角色模板，Leader 轮末主持，角色共享上下文；聊天可暂停、恢复、通过 @角色 定向追问、生成 Markdown 产物并一键转为正式任务。
- 工作台、新建任务五步流程、Team Chat、实时 Agent Inspector、Session/Run 历史、Workflow 阶段与模板详情、Artifact 版本与审批、可编辑 Agent 团队、Runtime 设置等核心页面。

## 本地运行

要求 Node.js 22+、Git，以及至少一个已登录的 Coding Agent CLI。

```bash
npm install
npm run dev
```

首次打开后：在“新建任务”中选择协作模式，填写目标，挂载一个或多个本地项目目录并选择 Agent。创建成功后 Agent Teams 会立即建立首个 Task 并启动 Leader Runtime，无需再发送一条消息才能开始执行。CLI 使用本机已有登录态，应用不保存 API Key。

纯思考场景可从“多人聊天”进入，不要求 Workspace。创建聊天时设置主题、背景、讨论模式、最大轮数和消息数；系统会按圆桌、头脑风暴、辩论或会诊自动生成本次角色模板，再映射到已配置的真实 Runtime Agent，避免把 Code Agent 等执行身份直接暴露为讨论角色。聊天支持 Markdown 共享记忆、输入框 @角色 定向追问和独立滚动；结束后可由 Leader 生成总结、行动计划、Design Brief、PRD 或决策矩阵，也可以选择 Workspace 将结论转换为现有 Evidence 驱动任务。

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

主窗口仅加载本地打包资源并启用 CSP、`contextIsolation`、sandbox 和 `nodeIntegration: false`。为兼容已有本地数据，数据库暂时继续使用 Electron `userData/database/moxt.db` 文件名；源码保留在用户选择的 Workspace，Agent Teams 不上传源码。停止 Run 默认保留工作区现场，不执行 `git reset --hard`。

## 工程边界

当前仓库已实现 V0.1 的独立 Runtime、Adapter/Resume/Queue、结构化协作模型、权限与 Worktree、Evidence 驱动 Leader 主链路。发布级收尾仍包括 Windows ConPTY 交互终端、Transcript 文件分片、Worktree 生命周期清理、签名公证、自动更新，以及使用已登录真实 CLI 完成五类场景的跨平台 E2E。未执行的真实 E2E 不会标记为已验收；详细状态见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

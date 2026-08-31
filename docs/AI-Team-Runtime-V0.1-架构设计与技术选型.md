# AI Team Runtime V0.1 架构设计与技术选型

> 文档目标：为《AI Team Runtime V0.1 需求设计文档》提供可直接进入开发的技术架构方案。V0.1 是真实可使用的跨桌面端应用，不以 Demo 为目标；必须支持 macOS、Windows、Linux，能够调用用户本机真实安装的 Claude Code、Codex、pi、OpenCode 或 Custom CLI，并完整实现 Agent Session、Run、Workflow、Evidence、Pause/Resume/Stop/Retry、多 Workspace、Git Worktree、跨项目协同和透明执行。

## 1. 架构结论

V0.1 推荐采用 **Electron + React + TypeScript + 独立 Agent Runtime + node-pty + SQLite + Git Worktree**。桌面 UI 负责交互和可视化；Electron Main 只负责窗口、系统能力和安全 IPC；核心 Team/Workflow/Agent/CLI 逻辑运行在独立的 Agent Runtime Process；真实 Coding Agent 由 Runtime 通过 PTY 或普通子进程启动；所有 Session、Run、Workflow、Artifact 和 Evidence 本地持久化。V0.1 不采用“Renderer 直接调用 Node/CLI”的架构，也不把 Team Runtime 塞进 Electron Main Process。

总体结构：

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Desktop Application                         │
│                    Electron + React/TS                          │
│                                                                 │
│  Team Chat / Workflow / Agent Inspector / Session / Diff        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Typed IPC
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Main Process                       │
│ Window / Tray / Dialog / Native OS / Security Boundary          │
│ IPC validation / Runtime lifecycle / App lifecycle              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ MessagePort / IPC
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Runtime Process                        │
│                                                                 │
│ Team Engine      Workflow Engine     Context Router             │
│ Leader Engine    Agent Manager       Session Manager            │
│ Run Manager      Event Bus           Evidence Service           │
│ Artifact         Workspace Manager   Persistence                │
└───────────────┬──────────────────────┬──────────────────────────┘
                │                      │
                │ Runtime Adapter      │ Workspace Adapter
                ▼                      ▼
        ┌───────────────┐       ┌───────────────────┐
        │ CLI Executor  │       │ Local Workspace   │
        │ PTY / Process │       │ Git / Worktree    │
        └───────┬───────┘       │ Files / Tests     │
                │               └───────────────────┘
      ┌─────────┼──────────┬───────────┐
      ▼         ▼          ▼           ▼
   Claude     Codex        pi       Custom CLI
    Code
```

核心原则是：**UI 与 Runtime 解耦、Team 与 Project 解耦、Agent 与 CLI 解耦、Session 与 Chat 解耦、Workflow 与具体执行步骤解耦。**

## 2. 为什么选择 Electron，而不是 Tauri

### 2.1 Electron 更符合本产品的核心负载

本产品最重的能力不是 UI，而是本机 CLI Runtime：需要发现 CLI、启动交互进程、管理 stdin/stdout、PTY、进程树、Session Resume、Git、文件系统、环境变量、Shell、长任务、流式日志以及多个 Agent 并行运行。Electron Main Process 原生运行 Node.js；Electron 还提供 `utilityProcess`，可创建独立 Node 子进程承载易崩溃、CPU 密集或不应放在 Main Process 的工作，并通过 MessagePort 通信。这与 Agent Runtime 的形态高度吻合。

Tauri 2 可以通过 Shell Plugin 启动系统命令，也支持 macOS/Windows/Linux，但核心后端是 Rust，Shell 调用受 Capability 配置约束。如果采用 Tauri，为了继续使用成熟 Node CLI/PTY 生态，通常还需要 Rust Process Layer、Node Sidecar 或更多桥接代码。对于一个以“管理本地 CLI”为核心能力的 V0.1，这会增加 Rust、Sidecar、Capability、JS/Rust IPC 四层复杂度，而不会给核心能力带来明显收益。

### 2.2 技术决策

| 维度 | Electron | Tauri 2 | V0.1 决策 |
|---|---|---|---|
| macOS/Windows/Linux | 成熟 | 成熟 | 均满足 |
| React/TS UI | 原生适配 | 原生适配 | 均满足 |
| Node.js 生态 | Main/Utility Process 直接使用 | 需要 Sidecar/桥接 | Electron |
| CLI/PTY | node-pty/child_process 直接集成 | Rust Shell + Sidecar 更复杂 | Electron |
| 长进程/流式事件 | Node 模型直接 | 可实现但桥接更多 | Electron |
| 安装包体积 | 较大 | 较小 | 本产品不以体积为第一目标 |
| 内存 | 较高 | 较低 | 可接受 |
| 第一版研发复杂度 | 较低 | 较高 | Electron |
| 后续 Native 能力 | Node Addon/系统 API | Rust 强 | 当前 Electron 足够 |

结论：**V0.1 使用 Electron。除非未来产品核心从“本地 CLI Runtime”转向“轻客户端 + 云 Runtime”，否则没有必要为了安装包更小而提前引入 Rust/Tauri 复杂度。**

## 3. 前端技术选型

前端使用 **React + TypeScript + Vite**。React 负责 Team Chat、Agent Inspector、Workflow、Session History、Diff/Test 等复杂状态 UI；TypeScript 与 Runtime 共用 Domain/Protocol 类型，减少 IPC 两端模型不一致；Vite 提供开发和构建。组件层建议使用 Radix UI/shadcn 风格的无头组件体系，自行控制产品视觉，不采用大而重的企业后台组件库。编辑器、Diff、终端分别采用 Monaco Editor、diff viewer 和 xterm.js；第一版不需要在 UI 内做完整 IDE，只需要满足 Transcript、Diff、日志和必要代码片段阅读。

状态管理建议分两类：**业务远端状态**来自 Runtime，通过 typed request/event store 管理；**纯 UI 状态**如选中 Agent、右栏开关、Tab、过滤条件使用 Zustand。不要把 Runtime 真相复制成一套复杂 Redux 状态机，Runtime 才是业务事实源，Renderer 只是 Projection。

推荐前端栈：

```text
React + TypeScript + Vite
Zustand                    UI local state
Zod                        IPC payload validation/shared schema
xterm.js                   terminal/session view
Monaco Editor              file/diff/code preview
react-markdown             Agent/Artifact markdown
Mermaid renderer           Proposal/architecture diagrams
```

## 4. Electron 进程模型

### 4.1 Renderer Process

Renderer 只负责 UI，不允许直接访问 Node.js、文件系统、Shell、SQLite 或 CLI。必须配置：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

Preload 通过 `contextBridge` 只暴露最小、类型明确的 API，例如：

```ts
window.teamRuntime.queryChange(id)
window.teamRuntime.sendMessage(command)
window.teamRuntime.controlRun(command)
window.teamRuntime.subscribeEvents(handler)
```

禁止把 `ipcRenderer.send`、`shell`、`fs` 等通用能力直接暴露给 Renderer。

### 4.2 Electron Main Process

Main Process 的职责必须控制在：Window/App 生命周期、Tray、File Dialog、Deep Link、系统通知、Renderer IPC 验证、启动/监控 Agent Runtime、应用升级。Main 不执行 Coding Agent，不保存 Team 状态，不承担 Workflow Engine，避免一个 CLI 卡死拖死整个桌面程序。

### 4.3 Agent Runtime Process

Agent Runtime 使用 Electron `utilityProcess.fork()` 启动独立 Node.js 进程。它承担所有核心业务：Team、Leader、Workflow、Context、Agent、Session、Run、CLI、Workspace、Git、Persistence、Artifact、Evidence。Electron 官方将 Utility Process 定位为 Node 子进程，并推荐它承载 CPU 密集、易崩溃或原本由 `child_process.fork` 承载的组件，因此与本产品 Runtime 非常匹配。

V0.1 使用：

```text
Renderer
   │
   │ IPC
   ▼
Main
   │
   │ MessagePort
   ▼
Utility Process (Agent Runtime)
```

内部协议必须独立于 Electron Transport，定义统一 `RuntimeCommand / RuntimeQuery / RuntimeEvent`。这样未来 Web/Mobile Remote Controller 可以增加 WebSocket Transport，而不用重写 Team Engine。

## 5. Monorepo 与代码结构

推荐 pnpm workspace：

```text
ai-team-runtime/
├── apps/
│   └── desktop/
│       ├── src/main/            Electron Main
│       ├── src/preload/         Narrow typed bridge
│       └── src/renderer/        React UI
├── packages/
│   ├── domain/                  Change/Team/Agent/Task/Run 等领域模型
│   ├── protocol/                RuntimeCommand/Query/Event + Zod schema
│   ├── runtime/                 Agent Runtime application
│   ├── workflow/                Workflow definition + state transition
│   ├── adapters/
│   │   ├── claude-code/
│   │   ├── codex/
│   │   ├── pi/
│   │   └── custom-cli/
│   ├── executor/                PTY/process/process-tree control
│   ├── workspace/               Git/worktree/file/environment
│   ├── persistence/             SQLite/Drizzle repositories
│   ├── context/                 Context Router/Trusted Context
│   ├── evidence/                Diff/Test/Command/Artifact evidence
│   └── shared/                  common utilities
├── tests/
│   ├── integration/
│   └── e2e/
└── package.json
```

Domain 包不能 import Electron、React、node-pty 等基础设施，实现 Clean Architecture 式依赖方向：`UI → Protocol → Application/Domain ← Adapter/Infrastructure`。Claude Code/Codex/pi 仅存在于 Adapter 层，绝不能渗透到 Team/Workflow 领域模型。

## 6. Runtime 内部架构

Runtime 推荐使用模块化单体，不在 V0.1 拆本地微服务。主要模块如下：

```text
TeamRuntime
├── TeamEngine
│   ├── team roster
│   ├── active agents
│   └── @mention routing
├── LeaderEngine
│   ├── observe
│   ├── decide
│   ├── delegate
│   ├── verify
│   └── replan
├── WorkflowEngine
│   ├── phase
│   ├── owner
│   ├── deliverable
│   ├── exit criteria
│   ├── gate
│   └── handoff
├── AgentManager
│   ├── Agent Pool
│   ├── runtime capability
│   └── workspace permission
├── RunManager
│   ├── queue
│   ├── start
│   ├── pause/resume
│   ├── stop/retry
│   └── execution lineage
├── SessionManager
│   ├── native session id
│   ├── transcript
│   └── resume/fork
├── ContextRouter
│   ├── relevance
│   ├── authority
│   ├── freshness
│   └── scope
├── WorkspaceManager
│   ├── project
│   ├── git worktree
│   ├── checkpoint
│   └── permissions
├── ArtifactService
├── EvidenceService
├── EventBus
└── Persistence
```

V0.1 不引入 Kafka/Redis/BullMQ。所有调度都在本地 Runtime 内，SQLite 负责持久化，Runtime 内使用轻量 async queue 控制并发。一个 Team 默认最大并发 3 个真实 CLI Run，可配置但必须存在上限，防止 CPU/内存/Token 被无限占用。

## 7. CLI Runtime Adapter

Agent 与 Coding CLI 必须完全解耦。统一接口建议：

```ts
interface AgentRuntimeAdapter {
  id(): RuntimeType;
  detect(): Promise<RuntimeDetection>;
  capabilities(): RuntimeCapabilities;

  start(input: StartRunInput): AsyncIterable<RuntimeEvent>;
  resume(input: ResumeRunInput): AsyncIterable<RuntimeEvent>;
  interrupt(run: RuntimeRunHandle): Promise<void>;
  cancel(run: RuntimeRunHandle): Promise<void>;

  parseFinalResult(raw: RuntimeOutput): Promise<AgentResult>;
  resolveSessionId(output: RuntimeOutput): string | null;
}
```

Capability 至少包含：

```ts
interface RuntimeCapabilities {
  streaming: boolean;
  nativeSession: boolean;
  resume: boolean;
  interrupt: boolean;
  structuredOutput: boolean;
  interactivePty: boolean;
  usage: boolean;
}
```

Claude Code/Codex 优先使用其可机器解析的非交互/结构化输出模式；需要真实交互终端或 Custom CLI 时使用 PTY。Team Chat 中展示的 `Final Response` 必须来自 Runtime Adapter 对真实 Session 结果的解析，不能由平台额外模拟。

## 8. PTY、进程与跨平台控制

CLI 执行使用两种策略：结构化非交互 CLI 用 `child_process.spawn`；需要交互终端、兼容完整 CLI 行为时使用 **node-pty**。node-pty 支持 Linux、macOS 和 Windows，Windows 基于 ConPTY，因此非常适合作为统一 PTY 层。由于 node-pty 是 Native Node Module，Electron 构建时必须按 Electron ABI 重建；Electron Forge 会自动调用 `@electron/rebuild` 处理 Native Module。

进程管理抽象：

```text
ProcessController
├── spawn()
├── write()
├── interrupt()
├── terminateTree()
├── getPid()
└── collectExit()
```

跨平台实现必须区分 POSIX 和 Windows。Unix 使用 process group/SIGINT/SIGTERM；Windows 使用 ConPTY 和进程树终止能力。不能简单调用 `process.kill(parentPid)` 后假设 CLI 创建的子进程全部退出。

### 8.1 Pause/Resume 的技术语义

V0.1 不把 OS 级 SIGSTOP/SIGCONT 当成通用 Pause，因为 Windows 不具备完全等价行为，并且长期冻结包含子进程的 Coding Agent 容易导致资源和终端状态异常。统一语义：

```text
Native Resume CLI:
Pause = graceful interrupt + 保存 native_session_id
Resume = 调用 CLI 原生 resume

No Native Resume CLI:
Pause = graceful stop + checkpoint
Resume = 创建新 Run，注入 previous run/context/checkpoint
```

因此 UI 显示统一 Pause/Resume，但底层可能是原生 Session Resume 或“Checkpoint 后新 Run”，后者必须明确产生新的 Run ID 和 Parent Run，不能伪装成同一进程继续。

### 8.2 Stop/Retry

Stop 必须结束真实进程树并将 Run 标记 `CANCELLED`，但不得自动回滚 Workspace。Retry 创建新 Run：

```text
Run #18 CANCELLED
   └── Run #19
       parent_run = #18
       reason = Human Override
       new_constraint = "Use IntegrationProvider"
```

## 9. 本地环境发现

CLI 可用性是跨桌面端最容易出问题的地方，不能只执行 `which claude`。GUI 应用在 macOS 下启动时 PATH 可能与 Terminal 不同，因此 Runtime 必须有统一 `EnvironmentResolver`：

```text
EnvironmentResolver
├── resolveHostEnv()
├── resolveLoginShellEnv()
├── findExecutable(name)
├── validateVersion()
└── detectCapabilities()
```

macOS/Linux 优先从用户 login shell 获取环境，再合并 App 环境；Windows 从 PATH、PowerShell `Get-Command`、常见安装位置检测。V0.1 UI 展示：

```text
Claude Code   ✓ /opt/homebrew/bin/claude
Codex         ✓ /usr/local/bin/codex
pi            ✕ Not Found
Custom CLI    +
```

每个 Runtime 必须提供 Test 按钮，真实执行 `--version` 或轻量探测命令。V0.1 先支持 Local Host；WSL、SSH、Docker 预留 `ExecutionEnvironment` 接口，在后续版本实现。

## 10. Workspace 与 Git 设计

Workspace 是 Agent 的真实工作现场。一个 Change 可以挂多个 Workspace，每个执行型 Workstream 默认拥有独立 Git Worktree：

```text
repo/
├── main checkout
└── .ai-team/worktrees/
    ├── change-108-de-agent/
    └── change-108-gf-agent/
```

Run 开始前保存 `workspace_id / worktree_path / branch / base_commit / git_status`。Agent Scope 独立于 Team Membership，例如 DE Agent 对 DE read/write、对 GF read-only；GF Agent 相反；Architect 可对两边 read-only。

WorkspaceManager 负责 create worktree、checkpoint、diff、status、commit metadata、cleanup。用户终止 Agent 时默认保留 Worktree 和 Diff；明确选择 Discard 后才回滚本 Run 的改动。跨 Repo Change 的两个 Workstream 必须完全独立，联调阶段由 Leader 根据 Proposal/Contract 和实际环境协调。

## 11. 数据持久化技术选型

V0.1 使用 **SQLite + better-sqlite3 + Drizzle ORM**。原因是应用完全本地化、单 Runtime 写入为主、事务需求明确、不需要部署数据库服务。`node:sqlite` 虽然已经进入 Node，但当前官方文档仍标记为 Release Candidate，因此 V0.1 不把核心持久化绑定在尚未完全稳定的内置模块上。better-sqlite3 是 Native Module，因此和 node-pty 一起纳入 Electron Native Module 构建链。

SQLite 启用 `WAL mode`、`foreign_keys = ON`、`busy_timeout`，关键状态切换使用事务。核心表包括：`t_workspace / t_agent / t_agent_runtime / t_change / t_team_session / t_workflow / t_workflow_phase / t_task / t_workstream / t_message / t_agent_session / t_run / t_artifact / t_decision / t_handoff / t_issue / t_evidence / t_human_intervention / t_event`。

`t_event` 采用 append-only，记录 `RUN_STARTED / RUN_COMPLETED / HUMAN_INTERVENTION / HANDOFF / ARTIFACT_APPROVED` 等关键事件。V0.1 不做完全 Event Sourcing，而采用 **Transactional State + Append-only Event Log**：状态表负责查询，Event Log 负责审计、Timeline 和恢复依据。

大型 Transcript 不全部塞 SQLite。建议：

```text
Application Data/
├── database/app.db
├── sessions/{sessionId}/transcript.jsonl
├── runs/{runId}/stdout.log
├── runs/{runId}/stderr.log
└── artifacts/
```

SQLite 保存路径、offset、摘要和索引，长 Transcript 使用增量读取。

## 12. Event 与 IPC 协议

Renderer 不直接订阅 node-pty；所有消息经过 Runtime Event Bus。协议分三类：Command（send_chat_message/start_change/control_run/approve_artifact）、Query（get_change/get_agent/get_session/get_run/get_diff/get_workflow）、Event（message.created/run.started/run.activity/run.completed/task.accepted/workflow.phase_changed/artifact.approved/handoff.created/human.intervention）。

所有协议定义在 `packages/protocol`，使用 TypeScript discriminated union + Zod runtime validation。Main Process 校验 Renderer 请求，Runtime 再做 Domain 权限校验。高频 `run.activity` 事件 50~100ms 合并推送一次，避免大量 stdout 使 Renderer 卡顿；原始日志仍完整写 Transcript。

## 13. Team Chat 的真实数据来源

Team Chat 中 Worker 的正式回复来自真实执行：

```text
Leader Assignment
      ↓
RunManager
      ↓
Real CLI Runtime
      ↓
AgentSession / Run
      ↓
FinalResponse + Evidence
      ↓
TeamEvent
      ↓
Team Chat Projection
```

Agent-to-Agent `@mention` 同样必须触发目标 Agent 的真实 Session：

```text
GF Agent FinalResponse
  "@de-agent 请确认 callback..."
             ↓
Mention Router
             ↓
Resume DE Agent Session
             ↓
Real CLI Run
             ↓
DE FinalResponse
             ↓
Team Chat
             ↓
Relevant response injected into GF Session
```

这一链路是 V0.1 最重要的 E2E 之一。

## 14. Workflow Engine

V0.1 不采用 n8n/Dify 式 DAG。Workflow 定义为责任状态机，每个 Phase 包含 `goal / ownerPolicy / allowedActions / requiredArtifacts / exitCriteria / handoff / fallback / humanMode`。WorkflowEngine 只管理 Phase、Policy、Exit Criteria、Gate、Handoff、Fallback；Leader 动态决定谁参与、是否并行、是否追加 Agent、是否重新调查、是否 Rework。V0.1 内置 5 个 Workflow：Cross-Project Change、Incident Investigation、Bug Fix、Controlled Refactor、Release Readiness。

状态推进必须事务化：

```text
check exit criteria
→ append workflow event
→ update phase
→ create handoff/task
→ commit transaction
```

App 崩溃后不能出现 Chat 已进入 Integration、数据库仍停在 Development 的状态。

## 15. Leader Engine

Leader 可以绑定一个 LLM/CLI Runtime，但拥有额外 Team Tools：`get_team_members / get_workspaces / get_workflow / get_current_truth / read_agent_result / read_agent_session / read_artifact / inspect_diff / inspect_tests / assign_agent / pause_run / cancel_run / request_review / create_handoff / create_issue / accept_task / replan`。

Leader 每次 Worker `RUN_COMPLETED` 后必须先进入 `VERIFYING`，读取任务目标、Approved Artifact、FinalResponse 和 Evidence，再决定 `ACCEPTED / REWORK / BLOCKED / NEXT`。实现上禁止写“Worker exit 0 → Task Done”的快捷逻辑。

## 16. Context Router

一次 Run 的 Context 由 `Role Context + Current Task + Agent Private Session + Current Workflow/Phase + Relevant Team Events + Approved/Current Artifacts + Relevant Workspace Evidence + Human Constraints` 组成。检索排序至少考虑 relevance、authority、freshness、scope；优先级建议：`Current Approved Contract/Proposal > 当前源码/真实 Evidence > Current Task Artifact > Current Decision > Verified historical Artifact > Session Summary > Team Discussion > Draft > Deprecated`。

V0.1 可以先使用 SQLite FTS5 做文本搜索和元数据过滤，不必须一开始引入向量数据库。项目代码理解仍优先交给 Claude Code/Codex 等 Coding Agent 自身，Context Router 的职责是控制跨 Agent/Team 信息进入 Session 的质量，而不是重新实现代码 RAG。

## 17. Artifact 与 Current Truth

Artifact 使用文件 + DB Metadata，核心字段：`type / status(DRAFT|REVIEW|APPROVED|DEPRECATED) / version / owner / scope / supersedes / source / approved_at`。例如 Proposal v2 Approved 后，Context Router 不得继续把 v1 当成同级事实；重大 Contract Change 创建 v3 并重新走 Gate，而不是覆盖 v2。Current Truth 是一组指向当前有效 Artifact、Decision 和 Workspace Evidence 的索引。

## 18. Evidence Service

EvidenceService 统一采集 `CommandEvidence / FileEvidence / DiffEvidence / GitEvidence / TestEvidence / BuildEvidence / IntegrationEvidence / RuntimeEvidence / ArtifactEvidence`。普通 stdout 不能自动判断为 Test PASS；只有 Runtime Adapter 或 Test Runner 能可靠解析时才生成结构化 PASS，否则保存 Raw Evidence 并标记 `UNVERIFIED`。Leader 可以引用 UNVERIFIED 信息，但不能把它等价成验收通过。

## 19. 安全架构

安全边界建立在 Renderer 与 Runtime 之间。Renderer 无 Node 权限；Preload 只暴露受控 API；Main 验证 IPC sender 与 payload；Runtime 对 Agent Workspace/Permission 二次校验。Agent 权限至少包含 `workspace.read / workspace.write / shell / git / network`。Agent Runtime 认证优先使用用户本机 CLI 已有登录态，不复制 Claude/Codex Token。Custom CLI 敏感 env 如需持久化，使用 OS Keychain/Electron safeStorage，不写明文 SQLite/日志。主窗口只加载打包后的本地资源，并启用 CSP、contextIsolation 和 sandbox。

## 20. 跨平台差异处理

平台差异统一封装在 `PlatformAdapter` 与 `ExecutionEnvironment`，业务层禁止散落 `process.platform` 判断。需要隔离的差异包括 Shell、PATH、Executable 查找、PTY、Process Tree Kill、文件路径、Git 可执行文件、系统通知、文件选择、签名/更新。路径统一使用 Node `path` API。

Windows V0.1 默认支持原生 PowerShell/cmd；WSL 作为 V0.2 ExecutionEnvironment。macOS 同时构建 arm64/x64；Windows 首先支持 x64；Linux 首先支持 x64。

## 21. 打包与发布

使用 **Electron Forge** 作为打包主工具。Electron 官方推荐 Forge 处理 packaging/distribution，并且 Forge 会自动处理 `@electron/rebuild`，这对 node-pty、better-sqlite3 等 Native Module 很重要。

CI 使用 GitHub Actions matrix：macOS 构建 arm64/x64 DMG/ZIP并完成 signing + notarization；Windows x64 构建 installer 并 code signing；Linux x64 构建 deb/rpm 或 zip。Native Module 必须在目标 OS/Arch Runner 上构建，不采用单平台交叉编译全部 native addon 的方案。正式发布必须完成 macOS Developer ID 签名/notarization 和 Windows code signing。

自动更新可在 V0.1 后半阶段加入；存在 Running Run 时禁止强制更新/重启。

## 22. 日志与可观测性

系统自身日志和 Agent Transcript 分离：App Log 记录 Electron/Main/Runtime 错误；Execution Transcript 保存真实 Agent Session；Audit Event 保存用户/Leader/Agent 关键操作。使用结构化 JSON Logger 写本地 rolling file，并提供“导出诊断包”，默认不包含用户源码和 Secret。

核心指标包括：`active_runs / queued_runs / run_duration / runtime_exit_code / workflow_phase_duration / ipc_event_rate / transcript_size / db_write_latency / runtime_crash_count`。

## 23. 崩溃与恢复

关键状态必须先持久化，再向 UI 发布最终状态事件。Runtime 启动时执行 Recovery：加载未完成 Change，扫描 RUNNING/STARTING Run，无法找到对应进程则标记 `INTERRUPTED`，恢复 Workflow，并向用户暴露 Resume/Retry。已完成 Session、Run、Artifact、Diff、Decision 不因 UI/Main/Runtime 重启丢失。

V0.1 不要求 Electron 整个退出后 Agent 作为系统后台服务继续运行；只要求重启应用后能够恢复状态并继续。后续如果明确需要“关闭 UI 后长期运行”，再将 Runtime 升级成 Local Daemon，避免第一版承担系统服务安装、升级和权限复杂度。

## 24. 测试架构

测试分五层：Unit（领域状态、Workflow、Context、Permission）、Adapter Contract Test（Claude/Codex/pi/Custom Runtime）、Integration（Runtime+SQLite、Git Worktree、node-pty、Pause/Resume/Retry、Agent-to-Agent）、Desktop E2E（Renderer→Main→Runtime→真实 CLI）、Scenario E2E（五种真实协作模式）。

CI 中需要 `FakeRuntimeAdapter` 做稳定自动化测试，但 Fake Adapter 仅用于测试，不能进入生产 Team。正式版本发布前必须额外执行至少 Claude Code/Codex 的真实 CLI E2E。

## 25. V0.1 技术里程碑

**M1 Desktop Shell + Runtime 骨架：** macOS/Windows/Linux 可启动；Renderer/Main/Runtime 三进程通信；SQLite/Event 持久化；Runtime 崩溃不拖死 Renderer。**M2 真实单 Agent：** 检测 Claude Code/Codex；真实 CLI；流式 Activity、Final Response、Session/Run、Transcript；Pause/Stop/Retry。**M3 Team + Agent-to-Agent：** 自定义 Agent；Leader 读取 Team Roster；两个 Worker 并行；@mention 触发目标真实 Session。**M4 Multi-Workspace + Workflow：** 两个 Repo、Worktree、Cross-Project Workflow、Proposal Gate、Artifact/Current Truth、Handoff。**M5 五种协作模式：** Cross-Project、Incident、Bug Fix、Controlled Refactor、Release Readiness 五个真实 E2E 全部通过。

## 26. V0.1 明确不做

V0.1 不做云端 Runtime、不做移动端执行、不做复杂 DAG Designer、不做 Kubernetes、不做 Redis/Kafka、不做向量数据库强依赖、不做自动 Team 自进化、不做 Agent Marketplace、不做完整 IDE、不做 WSL/SSH/Docker Executor、不要求 App 退出后 Runtime 作为系统服务永久运行。所有这些能力只留接口扩展点。

## 27. 关键技术风险

| 风险 | 影响 | V0.1 对策 |
|---|---|---|
| 不同 Coding CLI Session/输出差异 | Runtime 不稳定 | Adapter + Capability |
| CLI 需要真实终端 | spawn 行为不同 | node-pty fallback |
| Native Module 跨平台构建 | 安装包失败 | Forge + per-platform CI |
| macOS GUI PATH 不同 | 找不到 CLI | Login Shell EnvironmentResolver |
| Windows 子进程树难停止 | 残留进程 | Platform ProcessController |
| Agent 声称完成但无证据 | 可信度崩溃 | RUN_COMPLETED != TASK_ACCEPTED |
| Transcript 无限增长 | DB/UI 卡顿 | JSONL + SQLite index |
| Context 爆炸 | Agent 质量下降 | Context Router + Trusted Context |
| 多 Agent 同 Repo 冲突 | 代码污染 | Git Worktree |
| Runtime/App 崩溃 | 状态丢失 | persistence + recovery |
| Renderer 权限过大 | 本地执行风险 | sandbox/contextIsolation/narrow IPC |

## 28. 最终技术选型表

| 层 | 技术 |
|---|---|
| Desktop Framework | Electron |
| UI | React + TypeScript + Vite |
| UI State | Zustand |
| Validation/Protocol | Zod + TypeScript discriminated union |
| Main/Runtime Communication | Electron IPC + MessagePort |
| Runtime Process | Electron Utility Process / Node.js |
| CLI Execution | child_process.spawn + node-pty |
| Terminal | xterm.js |
| Code/Diff | Monaco Editor + lightweight diff viewer |
| Persistence | SQLite + better-sqlite3 + Drizzle |
| Large Transcript | JSONL/File + SQLite index |
| Workflow | Custom responsibility state machine |
| Event | Local typed Event Bus + append-only t_event |
| Git | system git CLI + Worktree |
| Packaging | Electron Forge |
| Logging | structured local logger |
| Testing | Vitest + Runtime integration + Electron E2E |
| Monorepo | pnpm workspace |
| Initial Platforms | macOS arm64/x64、Windows x64、Linux x64 |

## 29. 架构验收标准

架构完成不能以“Electron 能启动”作为验收。至少满足：① macOS、Windows、Linux 使用同一主代码库构建运行；② Renderer 无 Node 权限，所有高权限能力经过 Preload/Main/Runtime；③ Runtime 为独立进程，真实 CLI 不在 Renderer/Main 执行；④ Claude Code/Codex 至少两种真实 CLI Adapter 跑通；⑤ node-pty 在三平台通过集成测试；⑥一个 Change 可挂载两个真实 Repo，两个 Agent 独立 Worktree 并行；⑦真实 Session/Run/Transcript/FinalResponse/Evidence 可持久化恢复；⑧ Agent-to-Agent @mention 真实触发目标 CLI Session；⑨ Pause/Stop/Retry 控制真实进程并留下 Execution Lineage；⑩ Runtime/App 重启后未完成 Run 显示 Interrupted 并可 Resume/Retry；⑪ Approved Artifact 能覆盖旧 Draft 进入 Context；⑫五种 Workflow 状态、Gate、Handoff、Evidence 与需求文档一致；⑬最终 E2E 可以从 Change Done 回溯到 Agent Session → Run → CLI → Diff/Test/Artifact，而不是只有聊天记录。

## 30. 技术选型依据

- Electron 官方说明：Electron 将 Chromium 与 Node.js 集成，可使用同一 JavaScript 代码库构建 Windows、macOS、Linux 桌面应用。https://www.electronjs.org/docs/latest/
- Electron Process Model：Main 可以使用 Utility Process 创建独立 Node 子进程，并推荐将 CPU 密集、易崩溃或原本由 child_process 承载的组件放入 Utility Process。https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron Security：官方建议关闭 Renderer Node Integration、启用 Context Isolation/Sandbox、验证 IPC Sender。https://www.electronjs.org/docs/latest/tutorial/security
- Electron Packaging：官方推荐 Electron Forge 处理打包与分发；Forge 可自动处理 Electron Native Module rebuild。https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging
- node-pty：支持 Linux、macOS、Windows，Windows 使用 ConPTY。https://github.com/microsoft/node-pty
- Tauri 2 Shell：Tauri 同样可跨 Windows/Linux/macOS 启动子进程，但需要显式 Capability/Permission，因此第一版不选其作为 Runtime 主体。https://v2.tauri.app/plugin/shell/
- Node SQLite：当前官方文档中 `node:sqlite` 仍标记为 Release Candidate，因此 V0.1 暂不把核心持久化绑定在该 API。https://nodejs.org/api/sqlite.html

## 31. 一句话架构定义

**Electron 是跨平台桌面壳，React 是团队工作台，独立 Node Agent Runtime 是产品内核，Coding Agent CLI 是真实执行器，SQLite/Event 是可恢复事实层，Git Worktree 是代码隔离边界，Workflow/Leader 负责组织真实 Agent，而 Renderer 永远不直接掌握本机执行权限。**